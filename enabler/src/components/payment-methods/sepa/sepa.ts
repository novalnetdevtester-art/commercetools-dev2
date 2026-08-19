import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod,
} from "../../../payment-enabler/payment-enabler";

import { BaseComponent } from "../../base";

import styles from "../../../style/style.module.scss";
import buttonStyles from "../../../style/button.module.scss";

import {
  PaymentOutcome,
  PaymentRequestSchemaDTO,
} from "../../../dtos/novalnet-payment.dto";

import { BaseOptions } from "../../../payment-enabler/novalnet-payment-enabler";

const NOVALNET_UTILITY_CDN =
  "https://cdn.novalnet.de/js/v2/NovalnetUtility-1.1.2.js";

declare global {
  interface Window {
    NovalnetUtility?: {
      formatIban: (
        event: KeyboardEvent | Event,
        bicFieldId: string
      ) => boolean | void;

      formatBic: (
        event: KeyboardEvent | Event
      ) => boolean | void;
    };
  }
}

let novalnetUtilityPromise: Promise<void> | null = null;

/**
 * Load Novalnet Utility CDN only once.
 */
const loadNovalnetUtility = (): Promise<void> => {
  console.log("[SEPA] Checking NovalnetUtility...");

  if (window.NovalnetUtility) {
    console.log(
      "[SEPA] NovalnetUtility already available"
    );

    return Promise.resolve();
  }

  if (novalnetUtilityPromise) {
    console.log(
      "[SEPA] NovalnetUtility is already being loaded"
    );

    return novalnetUtilityPromise;
  }

  console.log(
    "[SEPA] Loading NovalnetUtility CDN:",
    NOVALNET_UTILITY_CDN
  );

  novalnetUtilityPromise = new Promise<void>(
    (resolve, reject) => {
      const existingScript =
        document.querySelector(
          `script[src="${NOVALNET_UTILITY_CDN}"]`
        );

      if (existingScript) {
        console.log(
          "[SEPA] NovalnetUtility script already exists in DOM"
        );

        if (window.NovalnetUtility) {
          console.log(
            "[SEPA] NovalnetUtility available from existing script"
          );

          resolve();

          return;
        }

        existingScript.addEventListener(
          "load",
          () => {
            console.log(
              "[SEPA] Existing NovalnetUtility script loaded"
            );

            if (window.NovalnetUtility) {
              resolve();
            } else {
              reject(
                new Error(
                  "NovalnetUtility loaded but is not available"
                )
              );
            }
          }
        );

        existingScript.addEventListener(
          "error",
          (error) => {
            console.error(
              "[SEPA] Existing NovalnetUtility script failed",
              error
            );

            reject(
              new Error(
                "Failed to load Novalnet Utility"
              )
            );
          }
        );

        return;
      }

      const script =
        document.createElement("script");

      script.src =
        NOVALNET_UTILITY_CDN;

      script.async = true;

      script.onload = () => {
        console.log(
          "[SEPA] NovalnetUtility CDN loaded"
        );

        console.log(
          "[SEPA] NovalnetUtility available:",
          !!window.NovalnetUtility
        );

        if (window.NovalnetUtility) {
          resolve();
        } else {
          reject(
            new Error(
              "NovalnetUtility loaded but is not available on window"
            )
          );
        }
      };

      script.onerror = (error) => {
        console.error(
          "[SEPA] Failed to load NovalnetUtility CDN",
          error
        );

        reject(
          new Error(
            "Failed to load Novalnet Utility CDN"
          )
        );
      };

      document.head.appendChild(
        script
      );
    }
  );

  return novalnetUtilityPromise;
};

export class SepaBuilder
  implements PaymentComponentBuilder
{
  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(
    config: ComponentOptions
  ): PaymentComponent {
    return new Sepa(
      this.baseOptions,
      config
    );
  }
}

export class Sepa extends BaseComponent {
  private showPayButton: boolean;

  private ibanInput?: HTMLInputElement;

  private bicInput?: HTMLInputElement;

  private bicContainer?: HTMLElement;

  private utilityReady = false;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {
    super(
      PaymentMethod.sepa,
      baseOptions,
      componentOptions
    );

    this.showPayButton =
      componentOptions?.showPayButton ??
      false;
  }

  mount(selector: string) {
    console.log(
      "[SEPA] Mounting SEPA component",
      {
        selector,
        showPayButton:
          this.showPayButton,
      }
    );

    /**
     * Fix CommerceTools selector issue.
     */
    const safeSelector =
      "#" +
      CSS.escape(
        selector.startsWith("#")
          ? selector.substring(1)
          : selector
      );

    console.log(
      "[SEPA] Safe selector:",
      safeSelector
    );

    const container =
      document.querySelector(
        safeSelector
      ) as HTMLElement | null;

    if (!container) {
      console.error(
        "[SEPA] Container not found:",
        safeSelector
      );

      return;
    }

    console.log(
      "[SEPA] SEPA container found"
    );

    /**
     * Same behavior as existing implementation.
     */
    container.insertAdjacentHTML(
      "afterbegin",
      this._getTemplate()
    );

    /**
     * Get SEPA form elements.
     */
    this.ibanInput =
      container.querySelector(
        "#nn_sepa_account_no"
      ) as HTMLInputElement | null ??
      undefined;

    this.bicInput =
      container.querySelector(
        "#nn_sepa_bic"
      ) as HTMLInputElement | null ??
      undefined;

    this.bicContainer =
      container.querySelector(
        "#nn_sepa_bic_container"
      ) as HTMLElement | null ??
      undefined;

    console.log(
      "[SEPA] Form elements initialized",
      {
        ibanInputFound:
          !!this.ibanInput,

        bicInputFound:
          !!this.bicInput,

        bicContainerFound:
          !!this.bicContainer,
      }
    );

    /**
     * BIC is initially hidden.
     */
    this.hideBic();

    /**
     * Update current payment label.
     */
    setTimeout(() => {
      const paymentLabel =
        container.querySelector(
          "label"
        );

      if (
        paymentLabel &&
        paymentLabel.textContent
          ?.toLowerCase()
          .includes("sepa")
      ) {
        paymentLabel.textContent =
          "Direct Debit SEPA";

        console.log(
          "[SEPA] Payment label updated"
        );
      }
    }, 100);

    /**
     * Initialize Novalnet utility.
     */
    void this.initializeNovalnetUtility();

    /**
     * Bind payment button.
     */
    if (this.showPayButton) {
      const button =
        container.querySelector(
          "#sepa-payment-button"
        ) as HTMLButtonElement | null;

      console.log(
        "[SEPA] Pay button found:",
        !!button
      );

      if (button) {
        button.addEventListener(
          "click",
          (event) => {
            console.log(
              "[SEPA] Pay Now button clicked"
            );

            event.preventDefault();

            void this.submit();
          }
        );
      }
    }
  }

  /**
   * Load Novalnet Utility and attach
   * IBAN/BIC utility handlers.
   */
  private async initializeNovalnetUtility() {
    console.log(
      "[SEPA] Initializing NovalnetUtility..."
    );

    try {
      await loadNovalnetUtility();

      console.log(
        "[SEPA] NovalnetUtility loaded successfully"
      );

      if (!window.NovalnetUtility) {
        throw new Error(
          "NovalnetUtility is not available"
        );
      }

      console.log(
        "[SEPA] Utility methods available:",
        {
          formatIban:
            typeof window
              .NovalnetUtility
              .formatIban ===
            "function",

          formatBic:
            typeof window
              .NovalnetUtility
              .formatBic ===
            "function",
        }
      );

      if (!this.ibanInput) {
        console.warn(
          "[SEPA] IBAN input not found"
        );

        return;
      }

      /**
       * IBAN keypress.
       */
      this.ibanInput.addEventListener(
        "keypress",
        (event) => {
          console.log(
            "[SEPA] IBAN keypress"
          );

          this.handleIban(event);
        }
      );

      /**
       * IBAN change.
       */
      this.ibanInput.addEventListener(
        "change",
        (event) => {
          console.log(
            "[SEPA] IBAN changed",
            {
              hasValue:
                !!this.ibanInput
                  ?.value
                  ?.trim(),

              length:
                this.ibanInput
                  ?.value
                  ?.trim()
                  .length ?? 0,
            }
          );

          this.handleIban(event);
        }
      );

      /**
       * BIC handling.
       */
      if (this.bicInput) {
        this.bicInput.addEventListener(
          "keypress",
          (event) => {
            console.log(
              "[SEPA] BIC keypress"
            );

            this.handleBic(event);
          }
        );

        this.bicInput.addEventListener(
          "change",
          (event) => {
            console.log(
              "[SEPA] BIC changed",
              {
                hasValue:
                  !!this.bicInput
                    ?.value
                    ?.trim(),

                length:
                  this.bicInput
                    ?.value
                    ?.trim()
                    .length ?? 0,
              }
            );

            this.handleBic(event);
          }
        );
      }

      this.utilityReady = true;

      console.log(
        "[SEPA] NovalnetUtility initialization completed"
      );

      /**
       * Apply utility to existing IBAN.
       */
      if (
        this.ibanInput.value.trim()
      ) {
        console.log(
          "[SEPA] Existing IBAN found, applying IBAN utility"
        );

        this.handleIban(
          new Event("change")
        );
      }
    } catch (error) {
      console.error(
        "[SEPA] Failed to initialize NovalnetUtility:",
        error
      );
    }
  }

  /**
   * Handle IBAN using Novalnet utility.
   */
  private handleIban(
    event: KeyboardEvent | Event
  ) {
    console.log(
      "[SEPA] handleIban() called",
      {
        eventType:
          event.type,

        utilityAvailable:
          !!window.NovalnetUtility,
      }
    );

    if (!window.NovalnetUtility) {
      console.warn(
        "[SEPA] NovalnetUtility unavailable while handling IBAN"
      );

      return;
    }

    try {
      const result =
        window.NovalnetUtility.formatIban(
          event,
          "nn_sepa_bic"
        );

      console.log(
        "[SEPA] NovalnetUtility.formatIban() result:",
        result
      );

      console.log(
        "[SEPA] IBAN state:",
        {
          hasValue:
            !!this.ibanInput
              ?.value
              ?.trim(),

          length:
            this.ibanInput
              ?.value
              ?.trim()
              .length ?? 0,

          bicCurrentlyVisible:
            this.bicContainer
              ?.style
              .display !==
            "none",
        }
      );

      /**
       * If the Novalnet utility returns
       * a boolean, use it for BIC visibility.
       */
      if (
        typeof result ===
        "boolean"
      ) {
        console.log(
          "[SEPA] Utility returned boolean. BIC visibility:",
          result
            ? "SHOW"
            : "HIDE"
        );

        if (result) {
          this.showBic();
        } else {
          this.hideBic();
        }
      } else {
        console.log(
          "[SEPA] Utility did not return a boolean; keeping current BIC visibility"
        );
      }
    } catch (error) {
      console.error(
        "[SEPA] Novalnet IBAN utility error:",
        error
      );
    }
  }

  /**
   * Handle BIC using Novalnet utility.
   */
  private handleBic(
    event: KeyboardEvent | Event
  ) {
    console.log(
      "[SEPA] handleBic() called",
      {
        eventType:
          event.type,

        utilityAvailable:
          !!window.NovalnetUtility,
      }
    );

    if (!window.NovalnetUtility) {
      console.warn(
        "[SEPA] NovalnetUtility unavailable while handling BIC"
      );

      return;
    }

    try {
      const result =
        window.NovalnetUtility.formatBic(
          event
        );

      console.log(
        "[SEPA] NovalnetUtility.formatBic() result:",
        result
      );
    } catch (error) {
      console.error(
        "[SEPA] Novalnet BIC utility error:",
        error
      );
    }
  }

  /**
   * Show BIC field.
   */
  private showBic() {
    if (!this.bicContainer) {
      console.warn(
        "[SEPA] Cannot show BIC: container not found"
      );

      return;
    }

    this.bicContainer.style.display =
      "flex";

    console.log(
      "[SEPA] BIC field: SHOWN"
    );
  }

  /**
   * Hide BIC field.
   */
  private hideBic() {
    if (!this.bicContainer) {
      console.warn(
        "[SEPA] Cannot hide BIC: container not found"
      );

      return;
    }

    this.bicContainer.style.display =
      "none";

    console.log(
      "[SEPA] BIC field: HIDDEN"
    );
  }

  async submit() {
    console.log(
      "[SEPA] Payment submission started"
    );

    /**
     * Make sure utility is available.
     */
    if (!this.utilityReady) {
      console.log(
        "[SEPA] NovalnetUtility not ready, loading..."
      );

      try {
        await loadNovalnetUtility();

        this.utilityReady = true;

        console.log(
          "[SEPA] NovalnetUtility ready"
        );
      } catch (error) {
        console.error(
          "[SEPA] Failed to load utility before submit:",
          error
        );

        this.onError(
          "Payment form could not be initialized. Please try again."
        );

        return;
      }
    }

    /**
     * Init SDK.
     */
    this.sdk.init({
      environment:
        this.environment,
    });

    const pathLocale =
      window.location.pathname
        .split("/")[1];

    const url =
      new URL(
        window.location.href
      );

    const baseSiteUrl =
      url.origin;

    try {
      /**
       * Form values.
       */
      const accountHolderInput =
        document.getElementById(
          "nn_account_holder"
        ) as HTMLInputElement | null;

      const ibanInput =
        document.getElementById(
          "nn_sepa_account_no"
        ) as HTMLInputElement | null;

      const bicInput =
        document.getElementById(
          "nn_sepa_bic"
        ) as HTMLInputElement | null;

      const accountHolder =
        accountHolderInput
          ?.value
          ?.trim() ?? "";

      const iban =
        ibanInput
          ?.value
          ?.replace(
            /\s+/g,
            ""
          )
          .toUpperCase() ?? "";

      const bic =
        bicInput
          ?.value
          ?.trim()
          .toUpperCase() ?? "";

      console.log(
        "[SEPA] Form validation:",
        {
          accountHolderPresent:
            !!accountHolder,

          ibanPresent:
            !!iban,

          ibanLength:
            iban.length,

          bicPresent:
            !!bic,

          bicLength:
            bic.length,

          bicVisible:
            this.bicContainer
              ?.style
              .display !==
            "none",
        }
      );

      /**
       * Account holder validation.
       */
      if (!accountHolder) {
        console.warn(
          "[SEPA] Account holder validation failed"
        );

        this.onError(
          "Please enter account holder name"
        );

        return;
      }

      /**
       * IBAN validation.
       */
      if (!iban) {
        console.warn(
          "[SEPA] IBAN validation failed"
        );

        this.onError(
          "Please enter IBAN"
        );

        return;
      }

      /**
       * Request payload.
       *
       * Existing business logic preserved.
       */
      const requestData:
        PaymentRequestSchemaDTO = {
        paymentMethod: {
          type:
            "DIRECT_DEBIT_SEPA",

          accHolder:
            accountHolder,

          iban:
            iban,

          bic:
            bic,
        },

        paymentOutcome:
          PaymentOutcome.AUTHORIZED,

        lang:
          pathLocale ?? "de",

        path:
          baseSiteUrl,
      };

      console.log(
        "[SEPA] Sending payment request",
        {
          endpoint:
            this.processorUrl +
            "/directPayment",

          paymentMethod:
            requestData
              .paymentMethod
              .type,

          paymentOutcome:
            requestData
              .paymentOutcome,

          language:
            requestData.lang,

          accountHolderPresent:
            !!requestData
              .paymentMethod
              .accHolder,

          ibanPresent:
            !!requestData
              .paymentMethod
              .iban,

          ibanLength:
            requestData
              .paymentMethod
              .iban
              ?.length,

          bicPresent:
            !!requestData
              .paymentMethod
              .bic,
        }
      );

      /**
       * API request.
       */
      const response =
        await fetch(
          this.processorUrl +
            "/directPayment",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              "X-Session-Id":
                this.sessionId,
            },

            body:
              JSON.stringify(
                requestData
              ),
          }
        );

      console.log(
        "[SEPA] Processor response status:",
        response.status
      );

      /**
       * HTTP error.
       */
      if (!response.ok) {
        const errorText =
          await response.text();

        console.error(
          "[SEPA] Processor HTTP error:",
          {
            status:
              response.status,

            response:
              errorText,
          }
        );

        throw new Error(
          `HTTP error! status: ${response.status}`
        );
      }

      /**
       * Parse response.
       */
      const data =
        await response.json();

      console.log(
        "[SEPA] Processor response:",
        data
      );

      /**
       * Payment success.
       */
      if (
        data?.paymentReference
      ) {
        console.log(
          "[SEPA] Payment successful",
          {
            paymentReference:
              data.paymentReference,
          }
        );

        this.onComplete?.({
          isSuccess: true,

          paymentReference:
            data.paymentReference,
        });

        return;
      }

      /**
       * Payment failure.
       */
      console.warn(
        "[SEPA] Payment failed",
        {
          transactionStatus:
            data?.transactionStatus,

          transactionStatusText:
            data?.transactionStatusText,
        }
      );

      this.onError(
        data?.transactionStatusText ||
          "Some error occurred. Please try again."
      );
    } catch (e: any) {
      console.error(
        "[SEPA] Submit error:",
        {
          message:
            e?.message,

          stack:
            e?.stack,

          name:
            e?.name,
        }
      );

      this.onError(
        "Some error occurred. Please try again."
      );
    }
  }

  private _getTemplate() {
    const payButton =
      this.showPayButton
        ? `
          <button
            class="
              ${buttonStyles.button}
              ${buttonStyles.fullWidth}
              ${styles.submitButton}
            "
            id="sepa-payment-button"
            type="button"
          >
            Pay Now
          </button>
        `
        : "";

    return `
      <div
        class="${styles.wrapper}"
        style="
          width:100%;
          display:flex;
          flex-direction:column;
          gap:20px;
          margin-top:20px;
        "
      >

        <p>
          Pay conveniently using
          Direct Debit SEPA.
        </p>

        <div
          id="nn_sepa_form"
          style="
            width:100%;
            display:flex;
            flex-direction:column;
            gap:20px;
          "
        >

          <!-- Account Holder -->
          <div
            style="
              display:flex;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="nn_account_holder"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              Account Holder
              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="nn_account_holder"
              name="nn_account_holder"
              autocomplete="off"
              style="
                padding:12px 14px;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
              "
            />

          </div>

          <!-- IBAN -->
          <div
            style="
              display:flex;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="nn_sepa_account_no"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              IBAN
              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="nn_sepa_account_no"
              name="nn_sepa_account_no"
              autocomplete="off"
              inputmode="text"
              style="
                padding:12px 14px;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                text-transform:uppercase;
              "
            />

          </div>

          <!-- BIC -->
          <div
            id="nn_sepa_bic_container"
            style="
              display:none;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="nn_sepa_bic"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              BIC
            </label>

            <input
              type="text"
              id="nn_sepa_bic"
              name="nn_sepa_bic"
              autocomplete="off"
              inputmode="text"
              style="
                padding:12px 14px;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                text-transform:uppercase;
              "
            />

          </div>

          ${payButton}

        </div>

      </div>
    `;
  }
}
