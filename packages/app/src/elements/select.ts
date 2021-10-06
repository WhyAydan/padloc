import "./icon";
import { css, html, LitElement, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { shared } from "../styles";

@customElement("pl-select")
export class Select<T> extends LitElement {
    @property({ attribute: false })
    options: { value: T; label?: string | TemplateResult | (() => string | TemplateResult); disabled?: boolean }[] = [];

    @state()
    selectedIndex: number = -1;

    get value(): T | null {
        return this.options[this.selectedIndex]?.value || null;
    }

    set value(val: T | null) {
        this.selectedIndex = this._select.selectedIndex = this.options.findIndex((o) => o.value === val);
    }

    @property({ reflect: true })
    label?: string;

    @property()
    icon?: string;

    @query("select")
    private _select: HTMLSelectElement;

    static styles = [
        shared,
        css`
            :host {
                display: block;
                position: relative;
                padding: 0;
                --padding: var(--button-padding, 0.7em);
            }

            select {
                width: 100%;
                box-sizing: border-box;
                cursor: pointer;
                padding: var(--padding);
                padding-right: calc(var(--padding) + 1.5em);
                background: var(--input-background);
                color: var(--input-color);
                border-width: var(--input-border-width, var(--border-width));
                border-style: var(--input-border-style, var(--border-style));
                border-color: var(--input-border-color, var(--border-color));
                border-radius: var(--input-border-radius, 0.5em);
                text-shadow: inherit;
                text-align: inherit;
                appearance: none;
                -webkit-appearance: none;
                font-weight: bold;
            }

            :host(.transparent) select {
                background: transparent;
                border: none;
            }

            label {
                position: absolute;
                font-size: var(--font-size-tiny);
                top: 0.6em;
                left: 1.2em;
                pointer-events: none;
                color: var(--color-highlight);
            }

            .dropdown-icon {
                position: absolute;
                top: 0;
                bottom: 0;
                right: 0.5em;
                margin: auto;
                pointer-events: none;
            }

            :host([label]) select {
                padding-top: calc(var(--padding) + 0.5em);
                padding-bottom: calc(var(--padding) - 0.5em);
            }
        `,
    ];

    render() {
        const { options, selectedIndex, label, icon } = this;

        return html`
            <select class="tap" .selectedIndex=${selectedIndex} @change=${() => this._changed()}>
                ${options.map(
                    ({ label, disabled, value }) =>
                        html`
                            <option ?disabled=${disabled}>
                                ${typeof label === "function" ? label() : label || value}
                            </option>
                        `
                )}
            </select>

            <pl-icon icon="dropdown" class="dropdown-icon"></pl-icon>

            <label class="horizontal spacing center-aligning layout">
                ${icon ? html` <pl-icon icon=${icon} class="small"></pl-icon> ` : ""}
                <div>${label}</div>
            </label>
        `;
    }

    updated(changes: Map<string, any>) {
        if (changes.has("options") || changes.has("selectedIndex")) {
            this._propsChanged();
        }
    }

    async _propsChanged() {
        // if (!this.value) {
        //     this.selectedIndex = this.options.findIndex((o) => !o.disabled);
        // }
    }

    private _changed() {
        this.selectedIndex = this._select.selectedIndex;
        this.dispatchEvent(new CustomEvent("change", { bubbles: true, composed: true }));
    }
}
