import { Err, ErrorCode } from "./error";
import { toByteArray, fromByteArray, byteLength, isBase64 } from "./base64";

/**
 * Base class for "serializable" classes, i.e. classes that can be serialized
 * into a plain javascript object, JSON string or byte sequence which can be
 * used for storage or data transfer. Subclasses will generally want to overwrite
 * the [[toRaw]], [[fromRaw]] and [[validate]] methods to account for their
 * specific class structure.
 *
 * @example
 *
 * ```ts
 * class MyClass extends Serializable {
 *      name: string;
 *      parent?: MyClass;
 *      bytes: Uint8Array;
 *
 *      toRaw() {
 *          return {
 *              ...super.toRaw(),
 *              bytes: bytesToBase64(this.bytes)
 *          };
 *      }
 *
 *      fromRaw({ bytes, parent, ...rest }) {
 *          return super.fromRaw({
 *              bytes: base64ToBytes(bytes),
 *              parent: parent && new MyClass().fromRaw(parent),
 *              ...rest
 *          });
 *      }
 *
 *      validate() {
 *          return (
 *              super.validate() &&
 *              typeof this.name === "string" &&
 *              this.bytes instanceof Uint8Array &&
 *              (
 *                  typeof this.parent === "undefined" ||
 *                  this.parent instanceof MyClass
 *              )
 *          )
 *      }
 * }
 * ```
 */
export class Serializable {
    /**
     * A string representing the objects "type", useful for segmenting storage,
     * among other things. Defaults to the lowercase class name, but can be
     * overwritten by subclasses
     */
    get type(): string {
        return this.constructor.name.toLowerCase();
    }

    /**
     * This is called during deserialization and should verify that all
     * properties have been populated with values of the correct type.
     * Subclasses should implement this method based on their class structure.
     */
    validate() {
        return true;
    }

    /**
     * Creates a raw javascript object representation of the class, which
     * can be used for storage or data transmission. The default implementation
     * simply copies all iterable properties with the exception of property
     * names passed in the `exclude` parameter. Recursively calls [[toRaw]] for
     * any properties that are also instances of `Serializable`.
     * The base implementation should be sufficient for most purposes but
     * can be overwritten by subclasses for customized behavior.
     */
    toRaw(exclude: string[] = []): object {
        const raw = {} as any;
        for (const [prop, val] of Object.entries(this)) {
            if (prop.startsWith("_") || exclude.includes(prop)) {
                continue;
            }

            if (val instanceof Serializable) {
                raw[prop] = val.toRaw();
            } else if (Array.isArray(val)) {
                raw[prop] = val.map((each: any) => (each instanceof Serializable ? each.toRaw() : each));
            } else {
                raw[prop] = val;
            }
        }
        return raw;
    }

    /**
     * Restores propertiers from a raw object of the same form generated by
     * [[toRaw]]. The base implementation blindly copies over values from the
     * raw object via `Object.assign` so subclasses should explictly process
     * any propertyies that need special treatment.
     *
     * The base implementation also takes are of validation so subclasses
     * should either call `super.fromRaw` or take care of validation
     * themselves.
     */
    fromRaw(raw: any): this {
        Object.assign(this, raw);
        try {
            if (!this.validate()) {
                console.log("failed to validate", this.type, raw);
                throw new Err(ErrorCode.ENCODING_ERROR);
            }
        } catch (e) {
            throw new Err(ErrorCode.ENCODING_ERROR);
        }
        return this;
    }

    /**
     * Returns a JSON serialization of the object
     */
    toJSON(): string {
        return JSON.stringify(this.toRaw());
    }

    /**
     * Deserializes the object from a JSON string
     */
    fromJSON(json: string): this {
        return this.fromRaw(JSON.parse(json));
    }

    /**
     * Returns a serialization of the object in form of a byte array
     */
    toBytes(): Uint8Array {
        return stringToBytes(this.toJSON());
    }

    /**
     * Deserializes the object from a byte array
     */
    fromBytes(bytes: Uint8Array): this {
        return this.fromJSON(bytesToString(bytes));
    }

    /**
     * Creates a deep clone of the object
     */
    clone(): this {
        // @ts-ignore: This causes a typescript warning for some reason but works fine in practice
        return new this.constructor().fromRaw(this.toRaw());
    }
}

/**
 * Creates a string from a raw javascript object
 */
export function marshal(obj: object): string {
    try {
        return JSON.stringify(obj);
    } catch (e) {
        throw new Err(ErrorCode.ENCODING_ERROR, e.toString());
    }
}

/**
 * Creates a raw javascript object from a string
 */
export function unmarshal(str: string): any {
    try {
        return JSON.parse(str);
    } catch (e) {
        throw new Err(ErrorCode.ENCODING_ERROR, e.toString());
    }
}

export { isBase64 };

/**
 * Converts a byte array to a base64 string
 */
export function bytesToBase64(inp: Uint8Array, urlSafe = true): string {
    try {
        return fromByteArray(inp, urlSafe);
    } catch (e) {
        throw new Err(ErrorCode.ENCODING_ERROR, e.toString());
    }
}

/**
 * Converts a base64 string to a byte array
 */
export function base64ToBytes(inp: string): Uint8Array {
    try {
        return toByteArray(inp);
    } catch (e) {
        throw new Err(ErrorCode.ENCODING_ERROR, e.toString());
    }
}

/**
 * Converts a utf-8 string to a byte array
 */
export function stringToBytes(str: string): Uint8Array {
    try {
        return new TextEncoder().encode(str);
    } catch (e) {
        throw new Err(ErrorCode.ENCODING_ERROR, e.toString());
    }
}

/**
 * Converts a byte array to an utf-8 string
 */
export function bytesToString(bytes: Uint8Array, encoding = "utf-8") {
    try {
        return new TextDecoder(encoding).decode(bytes);
    } catch (e) {
        throw new Err(ErrorCode.ENCODING_ERROR, e.toString());
    }
}

/**
 * Converts a utf-8 string to its base64 representation
 */
export function stringToBase64(str: string, urlSafe = true): string {
    const bytes = stringToBytes(str);
    return bytesToBase64(bytes, urlSafe);
}

/**
 * Converts the base64 representation of a utf-a string to it's original representation
 */
export function base64ToString(inp: string): string {
    const bytes = base64ToBytes(inp);
    return bytesToString(bytes);
}

/**
 * Returns the byte length of a base64 string
 */
export function base64ByteLength(inp: string): number {
    return byteLength(inp);
}

/**
 * Converts a hex string to a byte array
 */
export function hexToBytes(str: string): Uint8Array {
    try {
        const bytes = new Uint8Array(str.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(str.substring(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    } catch (e) {
        throw new Err(ErrorCode.ENCODING_ERROR, e.toString());
    }
}

/**
 * Converts a byte array to its hexadecimal representation
 */
export function bytesToHex(bytes: Uint8Array): string {
    try {
        let str = "";
        for (const b of bytes) {
            const s = b.toString(16);
            str += s.length == 1 ? "0" + s : s;
        }
        return str;
    } catch (e) {
        throw new Err(ErrorCode.ENCODING_ERROR, e.toString());
    }
}

/**
 * Converts a base64 string to its hexadecimal representation
 */
export function base64ToHex(b64: string): string {
    return bytesToHex(base64ToBytes(b64));
}

/**
 * Converts a hex string to its base64 representation
 */
export function hexToBase64(hex: string): string {
    return bytesToBase64(hexToBytes(hex));
}

/**
 * Concatenates a number of Uint8Arrays to a single array
 */
export function concatBytes(...arrs: Uint8Array[]): Uint8Array {
    const length = arrs.reduce((len, arr) => len + arr.length, 0);
    const res = new Uint8Array(length);
    let offset = 0;
    for (const arr of arrs) {
        res.set(arr, offset);
        offset += arr.length;
    }
    return res;
}

/** Checks two byte arrays for equality */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}
