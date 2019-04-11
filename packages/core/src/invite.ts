import { getProvider, PBKDF2Params, HMACParams, HMACKey } from "./crypto";
import { SimpleContainer } from "./container";
import {
    stringToBytes,
    bytesToString,
    bytesToHex,
    bytesToBase64,
    base64ToBytes,
    marshal,
    unmarshal,
    concatBytes
} from "./encoding";
import { Account, AccountID } from "./account";
import { Org, OrgID } from "./org";
import { uuid } from "./util";
import { Err, ErrorCode } from "./error";

export type InvitePurpose = "join_org" | "confirm_membership";

/**
 * Unique identifier for [[Invite]]s.
 */
export type InviteID = string;

/**
 * The `Invite` class encapsules most of the logic and information necessary to
 * perform a key exchange between an [[Org]] and [[Account]] before adding the
 * [[Account]] as a member. A secret HMAC key is used to sign and verify the public keys
 * of both invitee and organization. This key is derived from a [[secret]], which
 * needs to be communicated between the organization owner and invitee directly.
 *
 * The invite flow generally works as follows:
 *
 * ```ts
 * // ORG OWNER
 *
 * const invite = new Invite("bob@example.com", "add_member");
 *
 * // Generates random secret and signs organization details
 * await invite.intialize(org, orgOwnerAccount);
 *
 * console.log("invite secret: ", invite.secret);
 *
 * // => Invite object is send to server, which sends an email to the invitee
 *
 * // INVITEE
 * // => Invitee fetches `invite` object from server, asks org owner for `secret` (in person)
 *
 * // Verifies organization info and signs own public key
 *
 * const success = await invite.accept(inviteeAccount, secret);
 *
 * if (!success) {
 *     throw "Verification failed! Incorrect secret?";
 * }
 *
 * // => Sends updated invite object to server
 *
 * // ORG OWNER
 *
 * // => Fetches updated invite object
 *
 * // Verify invitee details.
 * if (!(await invite.verifyInvitee())) {
 *     throw "Failed to verify invitee details!";
 * }
 *
 * // DONE!
 * await org.addOrUpdateMember(invite.invitee);
 * ```
 */
export class Invite extends SimpleContainer {
    /** Unique identfier */
    id: InviteID = "";

    /** Time of creation */
    created = new Date();

    /**
     * Expiration time used to limit invite procedure to a certain time
     * window. This property is also stored in [[encryptedData]] along
     * with the invite secret to prevent tempering.
     */
    expires = new Date();

    /**
     * Organization info, including HMAC signature used for verification.
     * Set during initialization
     */
    org!: {
        id: OrgID;
        name: string;
        publicKey: Uint8Array;
        /**
         * Signature created using the HMAC key derived from [[secret]]
         * Used by invitee to verify organization details.
         */
        signature: Uint8Array;
    };

    /**
     * Invitee info, including HMAC signature used for verification
     * Set when the invitee successfully accepts the invite
     */
    invitee!: {
        id: AccountID;
        name: string;
        email: string;
        publicKey: Uint8Array;
        /**
         * Signature created using the HMAC key derived from [[secret]]
         * Used by organization owner to verify invitee details.
         */
        signature: Uint8Array;
        /**
         * Signature of organization details created using the invitee accounts
         * own secret signing key. Will be stored on the [[Member]] object to
         * allow the member to verify the organization details at a later time.
         */
        orgSignature: Uint8Array;
    };

    /** Info about who created the invite. */
    invitedBy!: {
        id: AccountID;
        name: string;
        email: string;
    };

    /**
     * Random secret used for deriving the HMAC key that is used to sign and
     * verify organization and invitee details. It is encrypted at rest with an
     * AES key only available to organization admins. The invitee does not have
     * access to this property directly but needs to request it from the
     * organization owner directly.
     *
     * @secret
     * **IMPORTANT**: This property is considered **secret**
     * and should never stored or transmitted in plain text
     */
    set secret(s: string) {
        this._secret = s;
        this._signingKey = null;
    }
    get secret() {
        return this._secret;
    }

    /** Whether this invite has expired */
    get expired(): boolean {
        return new Date() > new Date(this.expires);
    }

    /** Whether this invite has been accepted by the invitee */
    get accepted(): boolean {
        return !!this.invitee;
    }

    private _secret: string = "";
    private _signingKey: HMACKey | null = null;

    /** Key derivation paramaters used for deriving the HMAC signing key from [[secret]]. */
    signingKeyParams = new PBKDF2Params({
        iterations: 1e6
    });

    /**
     * Parameters used for signing organization and initee details.
     */
    signingParams = new HMACParams();

    constructor(
        /** invitee email */
        public email = "",
        /** purpose of the invite */
        public purpose: InvitePurpose = "join_org"
    ) {
        super();
    }

    /**
     * Initializes the invite by generating a random [[secret]] and [[id]] and
     * signing and storing the organization details.
     *
     * @param org The organization this invite is for
     * @param invitor Account creating the invite
     * @param duration Number of hours until this invite expires
     */
    async initialize(org: Org, invitor: Account, duration = 12) {
        this.id = await uuid();
        this.invitedBy = { id: invitor.id, email: invitor.email, name: invitor.name };

        // Generate secret
        this.secret = bytesToHex(await getProvider().randomBytes(4));
        // Set expiration time (12 hours from now)
        this.expires = new Date(Date.now() + 1000 * 60 * 60 * duration);

        // Encrypt secret and expiration date (the expiration time is also stored/transmitted
        // in plain text, encrypting it will allow verifying it wasn't tempered with later)
        this._key = org.invitesKey;
        await this.setData(stringToBytes(marshal({ secret: this.secret, expires: this.expires })));

        // Initialize signing params
        this.signingKeyParams.salt = await getProvider().randomBytes(16);

        // Create org signature using key derived from secret (see `_getSigningKey`)
        this.org = {
            id: org.id,
            name: org.name,
            publicKey: org.publicKey,
            signature: await this._sign(concatBytes(stringToBytes(org.id), org.publicKey))
        };
    }

    /**
     * "Unlocks" the invite with the dedicated key (owned by the respective [[Org]]).
     * This grants access to the [[secret]] property and verfies that [[expires]] has
     * not been tempered with.
     */
    async unlock(key: Uint8Array) {
        await super.unlock(key);
        const { secret, expires } = unmarshal(bytesToString(await this.getData()));
        this.secret = secret;

        // Verify that expiration time has not been tempered with
        if (this.expires.getTime() !== new Date(expires).getTime()) {
            throw new Err(ErrorCode.VERIFICATION_ERROR);
        }
    }

    lock() {
        super.lock();
        delete this.secret;
        delete this._signingKey;
    }

    validate() {
        return (
            super.validate() &&
            (typeof this.id === "string" &&
                typeof this.email === "string" &&
                ["join_org", "confirm_membership"].includes(this.purpose) &&
                typeof this.org === "object" &&
                typeof this.org.id === "string" &&
                typeof this.org.name === "string" &&
                (!this.invitee || (typeof this.invitee.id === "string" && typeof this.invitee.name === "string")) &&
                typeof this.invitedBy === "object" &&
                typeof this.invitedBy.id === "string" &&
                typeof this.invitedBy.name === "string" &&
                typeof this.invitedBy.email === "string")
        );
    }

    fromRaw({
        id,
        created,
        expires,
        email,
        purpose,
        org,
        invitee,
        invitedBy,
        signingKeyParams,
        signingParams,
        ...rest
    }: any) {
        this.signingKeyParams.fromRaw(signingKeyParams);
        this.signingParams.fromRaw(signingParams);
        Object.assign(this, {
            id,
            email,
            purpose,
            org: org && {
                ...org,
                publicKey: base64ToBytes(org.publicKey),
                signature: base64ToBytes(org.signature)
            },
            invitee: invitee && {
                ...invitee,
                publicKey: base64ToBytes(invitee.publicKey),
                signature: base64ToBytes(invitee.signature),
                orgSignature: base64ToBytes(invitee.orgSignature)
            },
            invitedBy,
            created: new Date(created),
            expires: new Date(expires)
        });
        return super.fromRaw(rest);
    }

    toRaw() {
        return {
            ...super.toRaw(),
            org: this.org && {
                ...this.org,
                publicKey: bytesToBase64(this.org.publicKey),
                signature: bytesToBase64(this.org.signature)
            },
            invitee: this.invitee && {
                ...this.invitee,
                publicKey: bytesToBase64(this.invitee.publicKey),
                signature: bytesToBase64(this.invitee.signature),
                orgSignature: bytesToBase64(this.invitee.orgSignature)
            }
        };
    }

    /**
     * Accepts the invite by verifying the organization details and, if successful,
     * signing and storing the invitees own information. Throws if verification
     * is unsuccessful.
     */
    async accept(account: Account, secret: string): Promise<boolean> {
        this.secret = secret;

        // Verify org signature
        if (!(await this.verifyOrg())) {
            this.secret = "";
            return false;
        }

        this.invitee = {
            id: account.id,
            name: account.name,
            email: account.email,
            publicKey: account.publicKey,
            // this is used by the organization owner to verify the invitees public key
            signature: await this._sign(
                concatBytes(stringToBytes(account.id), stringToBytes(account.email), account.publicKey)
            ),
            // this is used by member later to verify the organization public key
            orgSignature: await account.signOrg(this.org)
        };

        return true;
    }

    /** Verifies the organization information. */
    async verifyOrg(): Promise<boolean> {
        if (!this.org) {
            throw "Invite needs to be initialized first!";
        }

        return (
            this.expires > new Date() &&
            this._verify(this.org.signature, concatBytes(stringToBytes(this.org.id), this.org.publicKey))
        );
    }

    /** Verifies the invitee information. */
    async verifyInvitee(): Promise<boolean> {
        if (!this.invitee) {
            throw "Invite needs to be accepted first!";
        }

        return (
            this.expires > new Date() &&
            this._verify(
                this.invitee.signature,
                concatBytes(stringToBytes(this.invitee.id), stringToBytes(this.invitee.email), this.invitee.publicKey)
            )
        );
    }

    private async _getSigningKey() {
        if (!this._signingKey) {
            this._signingKey = (await getProvider().deriveKey(
                stringToBytes(this.secret),
                this.signingKeyParams
            )) as HMACKey;
        }
        return this._signingKey;
    }

    private async _sign(val: Uint8Array): Promise<Uint8Array> {
        return getProvider().sign(await this._getSigningKey(), val, this.signingParams);
    }

    private async _verify(sig: Uint8Array, val: Uint8Array): Promise<boolean> {
        return await getProvider().verify(await this._getSigningKey(), sig, val, this.signingParams);
    }
}
