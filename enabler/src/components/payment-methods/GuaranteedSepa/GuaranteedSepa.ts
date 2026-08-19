import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod,
} from '../../../payment-enabler/payment-enabler';

import { BaseComponent } from '../../base';

import styles from '../../../style/style.module.scss';
import buttonStyles from '../../../style/button.module.scss';

import {
  PaymentOutcome,
  PaymentRequestSchemaDTO,
} from '../../../dtos/novalnet-payment.dto';

import { BaseOptions } from '../../../payment-enabler/novalnet-payment-enabler';

declare global {
  interface Window {
    NovalnetUtility?: {
      checkIban?: (
        event: KeyboardEvent,
        bicDivId?: string
      ) => boolean | void;

      formatIban?: (
        event: Event,
        bicDivId?: string
      ) => boolean | void;

      formatBic?: (
        event: Event
      ) => boolean | void;
    };
  }
}

export class GuaranteedSepaBuilder
  implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(
    config: ComponentOptions
  ): PaymentComponent {

    return new GuaranteedSepa(
      this.baseOptions,
      config
    );
  }
}

export class GuaranteedSepa extends BaseComponent {

  private showPayButton: boolean;

  private utilityPromise:
    Promise<void> | null = null;

  private readonly utilityUrl =
    'https://cdn.novalnet.de/js/v2/NovalnetUtility-1.1.2.js';

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {

    super(
      PaymentMethod.GuaranteedSepa,
      baseOptions,
      componentOptions
    );

    this.showPayButton =
      componentOptions?.showPayButton ?? false;

    console.log(
      '[Guaranteed SEPA] Constructor initialized',
      {
        showPayButton:
          this.showPayButton,
      }
    );
  }

  mount(
    selector: string
  ) {

    console.log(
      '[Guaranteed SEPA] Mount started',
      {
        selector,
      }
    );

    /**
     * Fix commercetools selector issue.
     */
    const safeSelector =
      '#' +
      CSS.escape(
        selector.substring(1)
      );

    const container =
      document.querySelector(
        safeSelector
      );

    if (!container) {

      console.error(
        '[Guaranteed SEPA] Container not found:',
        safeSelector
      );

      return;
    }

    /**
     * Insert payment form.
     */
    container.insertAdjacentHTML(
      'afterbegin',
      this._getTemplate()
    );

    console.log(
      '[Guaranteed SEPA] Template inserted'
    );

    /**
     * Update only current payment label.
     */
    setTimeout(
      () => {

        const paymentLabel =
          container.querySelector(
            'label'
          );

        if (
          paymentLabel &&
          paymentLabel.textContent
            ?.toLowerCase()
            .includes('guaranteedsepa')
        ) {

          paymentLabel.textContent =
            'Direct Debit SEPA with payment guarantee';

          console.log(
            '[Guaranteed SEPA] Payment label updated'
          );
        }
      },
      100
    );

    /**
     * Load Novalnet Utility CDN.
     */
    void this.loadNovalnetUtility()
      .then(() => {

        console.log(
          '[Guaranteed SEPA] NovalnetUtility loaded'
        );

        this.initializeSepaUtility(
          container
        );

      })
      .catch(
        (error) => {

          console.error(
            '[Guaranteed SEPA] Failed to load NovalnetUtility',
            error
          );
        }
      );

    /**
     * Bind payment button.
     */
    if (
      this.showPayButton
    ) {

      const button =
        container.querySelector(
          '#purchaseOrderForm-paymentButton'
        );

      if (button) {

        button.addEventListener(
          'click',
          (event) => {

            event.preventDefault();

            console.log(
              '[Guaranteed SEPA] Pay button clicked'
            );

            void this.submit();
          }
        );

      } else {

        console.warn(
          '[Guaranteed SEPA] Payment button not found'
        );
      }
    }
  }

  /**
   * Load NovalnetUtility CDN only once.
   */
  private loadNovalnetUtility():
    Promise<void> {

    if (
      window.NovalnetUtility
    ) {

      console.log(
        '[Guaranteed SEPA] NovalnetUtility already available'
      );

      return Promise.resolve();
    }

    if (
      this.utilityPromise
    ) {

      return this.utilityPromise;
    }

    this.utilityPromise =
      new Promise<void>(
        (resolve, reject) => {

          const existingScript =
            document.querySelector(
              `script[src="${this.utilityUrl}"]`
            ) as HTMLScriptElement | null;

          if (existingScript) {

            console.log(
              '[Guaranteed SEPA] Existing NovalnetUtility script found'
            );

            existingScript.addEventListener(
              'load',
              () => {

                console.log(
                  '[Guaranteed SEPA] Existing utility script loaded'
                );

                resolve();
              },
              {
                once: true,
              }
            );

            existingScript.addEventListener(
              'error',
              () => {

                reject(
                  new Error(
                    'Failed to load NovalnetUtility'
                  )
                );
              },
              {
                once: true,
              }
            );

            return;
          }

          const script =
            document.createElement(
              'script'
            );

          script.type =
            'text/javascript';

          script.src =
            this.utilityUrl;

          script.async =
            true;

          script.onload =
            () => {

              console.log(
                '[Guaranteed SEPA] NovalnetUtility script loaded'
              );

              if (
                window.NovalnetUtility
              ) {

                resolve();

              } else {

                reject(
                  new Error(
                    'NovalnetUtility loaded but is not available'
                  )
                );
              }
            };

          script.onerror =
            () => {

              reject(
                new Error(
                  'Unable to load NovalnetUtility CDN'
                )
              );
            };

          document.head.appendChild(
            script
          );
        }
      );

    return this.utilityPromise;
  }

  /**
   * Initialize IBAN/BIC utility handling.
   */
  private initializeSepaUtility(
    container: Element
  ) {

    const ibanInput =
      container.querySelector(
        '#nn_guaranteesepa_account_no'
      ) as HTMLInputElement | null;

    const bicInput =
      container.querySelector(
        '#nn_guaranteesepa_bic'
      ) as HTMLInputElement | null;

    if (!ibanInput) {

      console.error(
        '[Guaranteed SEPA] IBAN input not found'
      );

      return;
    }

    if (!bicInput) {

      console.error(
        '[Guaranteed SEPA] BIC input not found'
      );

      return;
    }

    /**
     * Initial BIC state.
     */
    this.handleIban(
      ibanInput,
      'initial'
    );

    /**
     * IBAN keyboard/input changes.
     */
    ibanInput.addEventListener(
      'input',
      () => {

        console.log(
          '[Guaranteed SEPA] IBAN input',
          {
            hasValue:
              !!ibanInput.value.trim(),

            length:
              ibanInput.value.length,
          }
        );

        this.handleIban(
          ibanInput,
          'input'
        );
      }
    );

    ibanInput.addEventListener(
      'keyup',
      (event) => {

        console.log(
          '[Guaranteed SEPA] IBAN keyup',
          {
            hasValue:
              !!ibanInput.value.trim(),

            length:
              ibanInput.value.length,
          }
        );

        this.handleIban(
          ibanInput,
          'keyup',
          event
        );
      }
    );

    ibanInput.addEventListener(
      'change',
      (event) => {

        console.log(
          '[Guaranteed SEPA] IBAN changed',
          {
            hasValue:
              !!ibanInput.value.trim(),

            length:
              ibanInput.value.length,
          }
        );

        this.handleIban(
          ibanInput,
          'change',
          event
        );
      }
    );

    /**
     * BIC formatting.
     */
    bicInput.addEventListener(
      'keypress',
      (event) => {

        try {

          const utility =
            window.NovalnetUtility;

          if (
            utility?.formatBic
          ) {

            utility.formatBic(
              event
            );
          }

        } catch (error) {

          console.error(
            '[Guaranteed SEPA] BIC keypress formatting error',
            error
          );
        }
      }
    );

    bicInput.addEventListener(
      'change',
      (event) => {

        try {

          const utility =
            window.NovalnetUtility;

          if (
            utility?.formatBic
          ) {

            const result =
              utility.formatBic(
                event
              );

            console.log(
              '[Guaranteed SEPA] formatBic result:',
              result
            );
          }

        } catch (error) {

          console.error(
            '[Guaranteed SEPA] BIC formatting error',
            error
          );
        }
      }
    );

    console.log(
      '[Guaranteed SEPA] NovalnetUtility event handlers initialized'
    );
  }

  /**
   * Handle IBAN formatting and BIC visibility.
   *
   * The complete BIC container is hidden/shown so
   * the BIC label is hidden together with the input.
   */
  private handleIban(
    ibanInput: HTMLInputElement,
    eventType: string,
    event?: Event
  ) {

    const utility =
      window.NovalnetUtility;

    const bicContainer =
      document.getElementById(
        'guaranteed-sepa-bic-container'
      );

    if (!bicContainer) {

      console.error(
        '[Guaranteed SEPA] BIC container not found'
      );

      return;
    }

    console.log(
      '[Guaranteed SEPA] handleIban() called',
      {
        eventType,
        utilityAvailable:
          !!utility,
      }
    );

    if (!ibanInput.value.trim()) {

      this.setBicVisibility(
        bicContainer,
        false
      );

      console.log(
        '[Guaranteed SEPA] IBAN empty - BIC hidden'
      );

      return;
    }

    /**
     * Format IBAN through NovalnetUtility.
     */
    try {

      if (
        utility?.formatIban
      ) {

        const formatEvent =
          event ??
          new Event(
            eventType
          );

        const result =
          utility.formatIban(
            formatEvent,
            'guaranteed-sepa-bic-container'
          );

        console.log(
          '[Guaranteed SEPA] NovalnetUtility.formatIban() result:',
          result
        );

      } else {

        console.warn(
          '[Guaranteed SEPA] NovalnetUtility.formatIban() unavailable'
        );
      }

    } catch (error) {

      console.error(
        '[Guaranteed SEPA] IBAN formatting error',
        error
      );
    }

    /**
     * The Novalnet utility may manipulate the BIC
     * container directly. We still normalize the
     * final visibility here so the label and field
     * always behave together.
     */
    const bicCurrentlyVisible =
      bicContainer.style.display !== 'none';

    console.log(
      '[Guaranteed SEPA] IBAN state',
      {
        hasValue:
          !!ibanInput.value.trim(),

        length:
          ibanInput.value.length,

        bicCurrentlyVisible,
      }
    );

    /**
     * NovalnetUtility can internally control BIC
     * visibility. If it changed the container,
     * preserve that state.
     */
    const computedStyle =
      window.getComputedStyle(
        bicContainer
      );

    const utilityWantsBicVisible =
      computedStyle.display !== 'none';

    /**
     * If the utility has made a decision,
     * preserve it.
     */
    this.setBicVisibility(
      bicContainer,
      utilityWantsBicVisible
    );

    console.log(
      '[Guaranteed SEPA] Final BIC visibility',
      {
        visible:
          utilityWantsBicVisible,
      }
    );
  }

  /**
   * Show/hide the complete BIC field including
   * label and validation message.
   */
  private setBicVisibility(
    bicContainer: HTMLElement,
    visible: boolean
  ) {

    bicContainer.style.display =
      visible
        ? 'flex'
        : 'none';

    /**
     * Also control all child elements so that
     * the label can never remain visible.
     */
    if (!visible) {

      const label =
        bicContainer.querySelector(
          'label'
        ) as HTMLElement | null;

      const input =
        bicContainer.querySelector(
          'input'
        ) as HTMLElement | null;

      const error =
        bicContainer.querySelector(
          '.bic-error'
        ) as HTMLElement | null;

      if (label) {
        label.style.display =
          'none';
      }

      if (input) {
        input.style.display =
          'none';
      }

      if (error) {
        error.style.display =
          'none';
      }

    } else {

      const label =
        bicContainer.querySelector(
          'label'
        ) as HTMLElement | null;

      const input =
        bicContainer.querySelector(
          'input'
        ) as HTMLElement | null;

      if (label) {
        label.style.display =
          'block';
      }

      if (input) {
        input.style.display =
          'block';
      }
    }
  }

  async submit() {

    console.log(
      '[Guaranteed SEPA] Submit started'
    );

    /**
     * Initialize SDK.
     */
    this.sdk.init({
      environment:
        this.environment,
    });

    const pathLocale =
      window.location.pathname
        .split('/')[1] ?? 'de';

    const baseSiteUrl =
      window.location.origin;

    try {

      /**
       * Form values.
       */
      const accountHolderInput =
        document.getElementById(
          'nn_account_holder'
        ) as HTMLInputElement | null;

      const ibanInput =
        document.getElementById(
          'nn_guaranteesepa_account_no'
        ) as HTMLInputElement | null;

      const bicInput =
        document.getElementById(
          'nn_guaranteesepa_bic'
        ) as HTMLInputElement | null;

      const birthdateInput =
        document.getElementById(
          'nn_sepa_birthdate'
        ) as HTMLInputElement | null;

      const accountHolder =
        accountHolderInput
          ?.value
          ?.trim() ?? '';

      const iban =
        ibanInput
          ?.value
          ?.trim() ?? '';

      const bic =
        bicInput
          ?.value
          ?.trim() ?? '';

      const birthdate =
        birthdateInput
          ?.value
          ?.trim() ?? '';

      console.log(
        '[Guaranteed SEPA] Form validation',
        {
          accountHolderAvailable:
            !!accountHolder,

          ibanAvailable:
            !!iban,

          bicAvailable:
            !!bic,

          birthdateAvailable:
            !!birthdate,
        }
      );

      /**
       * All required fields.
       */
      if (
        !accountHolder ||
        !iban ||
        !bic ||
        !birthdate
      ) {

        console.warn(
          '[Guaranteed SEPA] Required field validation failed'
        );

        this.onError(
          'Please fill all required fields.'
        );

        return;
      }

      /**
       * Payment request.
       *
       * Business logic unchanged.
       */
      const requestData:
        PaymentRequestSchemaDTO = {

        paymentMethod: {

          type:
            'GUARANTEED_DIRECT_DEBIT_SEPA',

          accHolder:
            accountHolder,

          iban:
            iban,

          bic:
            bic,

          birthdate:
            birthdate,
        },

        paymentOutcome:
          PaymentOutcome.AUTHORIZED,

        lang:
          pathLocale,

        path:
          baseSiteUrl,
      };

      /**
       * Do not log sensitive bank information.
       */
      console.log(
        '[Guaranteed SEPA] Payment request prepared',
        {
          paymentMethod:
            requestData.paymentMethod.type,

          paymentOutcome:
            requestData.paymentOutcome,

          lang:
            requestData.lang,

          path:
            requestData.path,

          accountHolderAvailable:
            !!accountHolder,

          ibanLength:
            iban.length,

          bicLength:
            bic.length,

          birthdateAvailable:
            !!birthdate,
        }
      );

      /**
       * Direct payment.
       */
      const response =
        await fetch(
          this.processorUrl +
            '/directPayment',
          {
            method:
              'POST',

            headers: {

              'Content-Type':
                'application/json',

              'X-Session-Id':
                this.sessionId,
            },

            body:
              JSON.stringify(
                requestData
              ),
          }
        );

      console.log(
        '[Guaranteed SEPA] Payment API response',
        {
          status:
            response.status,

          ok:
            response.ok,
        }
      );

      if (!response.ok) {

        const errorText =
          await response.text();

        console.error(
          '[Guaranteed SEPA] HTTP error response',
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

      const data =
        await response.json();

      console.log(
        '[Guaranteed SEPA] Payment response received',
        {
          hasPaymentReference:
            !!data?.paymentReference,

          transactionStatus:
            data?.transactionStatus,

          transactionStatusText:
            data?.transactionStatusText,
        }
      );

      /**
       * Payment success.
       */
      if (
        data?.paymentReference
      ) {

        const paymentReference =
          typeof data.paymentReference ===
          'string'
            ? data.paymentReference
            : data.paymentReference?.id;

        if (!paymentReference) {

          console.error(
            '[Guaranteed SEPA] Payment reference could not be resolved'
          );

          this.onError(
            'Payment reference missing.'
          );

          return;
        }

        console.log(
          '[Guaranteed SEPA] Calling onComplete',
          {
            paymentReference,
          }
        );

        this.onComplete?.({
          isSuccess:
            true,

          paymentReference,
        });

        return;
      }

      /**
       * Payment failure.
       */
      console.error(
        '[Guaranteed SEPA] Payment reference missing',
        {
          transactionStatus:
            data?.transactionStatus,

          transactionStatusText:
            data?.transactionStatusText,
        }
      );

      this.onError(
        data?.transactionStatusText ||
          'Some error occurred. Please try again.'
      );

    } catch (
      error: unknown
    ) {

      console.error(
        '[Guaranteed SEPA] Payment error',
        {
          message:
            error instanceof Error
              ? error.message
              : String(error),

          stack:
            error instanceof Error
              ? error.stack
              : undefined,
        }
      );

      this.onError(
        'Some error occurred. Please try again.'
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
            id="purchaseOrderForm-paymentButton"
            type="button"
          >
            Pay
          </button>
        `
        : '';

    return `
      <div
        style="
          width:100%;
          display:flex;
          flex-direction:column;
          gap:20px;
          margin-top:20px;
        "
      >

        <form
          id="nn_guaranteesepa_form"
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
              autocomplete="name"
              required
              style="
                width:100%;
                padding:12px 14px;
                border:1.5px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                box-sizing:border-box;
                transition:all 0.2s ease-in-out;
              "
            />

            <span
              style="
                display:none;
                margin-top:4px;
                font-size:12px;
                color:#d70000;
              "
            >
              Invalid account holder
            </span>

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
              for="nn_guaranteesepa_account_no"
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
              id="nn_guaranteesepa_account_no"
              name="nn_guaranteesepa_account_no"
              size="32"
              autocomplete="off"
              required
              style="
                width:100%;
                padding:12px 14px;
                border:1.5px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                text-transform:uppercase;
                box-sizing:border-box;
                transition:all 0.2s ease-in-out;
              "
            />

            <span
              style="
                display:none;
                margin-top:4px;
                font-size:12px;
                color:#d70000;
              "
            >
              Invalid IBAN
            </span>

          </div>

          <!-- BIC FIELD -->
          <div
            id="guaranteed-sepa-bic-container"
            style="
              display:none;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="nn_guaranteesepa_bic"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              BIC
              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="nn_guaranteesepa_bic"
              name="nn_guaranteesepa_bic"
              size="32"
              autocomplete="off"
              required
              style="
                width:100%;
                padding:12px 14px;
                border:1.5px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                box-sizing:border-box;
                transition:all 0.2s ease-in-out;
              "
            />

            <span
              class="bic-error"
              style="
                display:none;
                margin-top:4px;
                font-size:12px;
                color:#d70000;
              "
            >
              Invalid BIC
            </span>

          </div>

          <!-- Birthdate -->
          <div
            style="
              display:flex;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="nn_sepa_birthdate"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              Birthdate (DD-MM-YYYY)
              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="nn_sepa_birthdate"
              name="nn_sepa_birthdate"
              placeholder="DD-MM-YYYY"
              maxlength="10"
              required
              style="
                width:100%;
                padding:12px 14px;
                border:1.5px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                box-sizing:border-box;
                transition:all 0.2s ease-in-out;
              "
            />

            <span
              id="nn_sepa_birthdate_error"
              style="
                display:none;
                margin-top:4px;
                font-size:12px;
                color:#d70000;
              "
            >
              Invalid birthdate
            </span>

          </div>

          ${payButton}

        </form>

      </div>
    `;
  }
}
