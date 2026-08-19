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

export class AchBuilder
  implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(
    config: ComponentOptions
  ): PaymentComponent {

    return new Ach(
      this.baseOptions,
      config
    );
  }
}

export class Ach extends BaseComponent {

  private showPayButton: boolean;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {

    super(
      PaymentMethod.ach,
      baseOptions,
      componentOptions
    );

    this.showPayButton =
      componentOptions?.showPayButton ?? false;

    console.log(
      '[ACH] Constructor initialized',
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
      '[ACH] Mount started',
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
        '[ACH] Container not found:',
        safeSelector
      );

      return;
    }

    /**
     * Same behavior as iDEAL.
     * Prevent radio button removal.
     */
    container.insertAdjacentHTML(
      'afterbegin',
      this._getTemplate()
    );

    console.log(
      '[ACH] ACH template inserted'
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
            .includes('ach')
        ) {

          paymentLabel.textContent =
            'Direct Debit ACH';

          console.log(
            '[ACH] Payment label updated'
          );
        }
      },
      100
    );

    /**
     * Bind payment button.
     */
    if (
      this.showPayButton
    ) {

      const button =
        document.querySelector(
          '#achForm-paymentButton'
        );

      if (button) {

        console.log(
          '[ACH] Payment button found'
        );

        button.addEventListener(
          'click',
          (event) => {

            event.preventDefault();

            console.log(
              '[ACH] Pay Now clicked'
            );

            void this.submit();
          }
        );

      } else {

        console.warn(
          '[ACH] Payment button not found'
        );
      }
    }
  }

  async submit() {

    console.log(
      '[ACH] Submit started'
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
        .split('/')[1] ?? 'en';

    const baseSiteUrl =
      window.location.origin;

    try {

      /**
       * Get form fields.
       */
      const accountHolderInput =
        document.getElementById(
          'achForm-accHolder'
        ) as HTMLInputElement | null;

      const accountNumberInput =
        document.getElementById(
          'achForm-accountNumber'
        ) as HTMLInputElement | null;

      const routingNumberInput =
        document.getElementById(
          'achForm-routingNumber'
        ) as HTMLInputElement | null;

      const accountHolder =
        accountHolderInput
          ?.value
          ?.trim() ?? '';

      const accountNumber =
        accountNumberInput
          ?.value
          ?.trim() ?? '';

      const routingNumber =
        routingNumberInput
          ?.value
          ?.trim() ?? '';

      console.log(
        '[ACH] Form validation',
        {
          accountHolderAvailable:
            !!accountHolder,

          accountNumberAvailable:
            !!accountNumber,

          routingNumberAvailable:
            !!routingNumber,
        }
      );

      /**
       * Validate required fields.
       *
       * All three ACH fields are mandatory.
       */
      if (
        !accountHolder ||
        !accountNumber ||
        !routingNumber
      ) {

        console.warn(
          '[ACH] Required field validation failed'
        );

        this.onError(
          'Please fill all required fields.'
        );

        return;
      }

      /**
       * Prepare payment request.
       *
       * Business logic unchanged.
       */
      const requestData:
        PaymentRequestSchemaDTO = {

        paymentMethod: {

          type:
            'DIRECT_DEBIT_ACH',

          accHolder:
            accountHolder,

          accountNumber:
            accountNumber,

          routingNumber:
            routingNumber,
        },

        paymentOutcome:
          PaymentOutcome.AUTHORIZED,

        lang:
          pathLocale,

        path:
          baseSiteUrl,
      };

      /**
       * Do not log account/routing numbers.
       */
      console.log(
        '[ACH] Payment request prepared',
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

          accountNumberLength:
            accountNumber.length,

          routingNumberLength:
            routingNumber.length,
        }
      );

      /**
       * Send payment request.
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
        '[ACH] Payment API response',
        {
          status:
            response.status,

          ok:
            response.ok,
        }
      );

      /**
       * Handle HTTP errors.
       */
      if (!response.ok) {

        const errorText =
          await response.text();

        console.error(
          '[ACH] HTTP error response',
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
        '[ACH] Payment response received',
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
       * Payment successful.
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
            '[ACH] Payment reference exists but could not be resolved',
            {
              paymentReference:
                data.paymentReference,
            }
          );

          this.onError(
            'Payment reference missing.'
          );

          return;
        }

        console.log(
          '[ACH] Calling onComplete',
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
       * Payment failed.
       */
      console.error(
        '[ACH] Payment reference missing',
        {
          transactionStatus:
            data?.transactionStatus,

          transactionStatusText:
            data?.transactionStatusText,
        }
      );

      this.onError(
        data?.transactionStatusText ||
          'Payment reference missing.'
      );

    } catch (
      error: unknown
    ) {

      console.error(
        '[ACH] Payment error',
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

    const locale =
      document.documentElement.lang ||
      'en';

    const isGerman =
      locale
        .toLowerCase()
        .startsWith('de');

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

        <div
          style="
            display:flex;
            flex-direction:column;
            gap:20px;
            width:100%;
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
              for="achForm-accHolder"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              ${
                isGerman
                  ? 'Kontoinhaber'
                  : 'Account Holder'
              }

              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="achForm-accHolder"
              name="accHolder"
              autocomplete="name"
              required
              style="
                width:100%;
                padding:12px 14px;
                margin-top:0;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                box-sizing:border-box;
              "
            />

          </div>

          <!-- Account Number -->
          <div
            style="
              display:flex;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="achForm-accountNumber"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              ${
                isGerman
                  ? 'Kontonummer'
                  : 'Account Number'
              }

              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="achForm-accountNumber"
              name="accountNumber"
              autocomplete="off"
              inputmode="numeric"
              required
              style="
                width:100%;
                padding:12px 14px;
                margin-top:0;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                box-sizing:border-box;
              "
            />

          </div>

          <!-- Routing Number -->
          <div
            style="
              display:flex;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="achForm-routingNumber"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              ${
                isGerman
                  ? 'Bankleitzahl'
                  : 'Routing Number'
              }

              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="achForm-routingNumber"
              name="routingNumber"
              autocomplete="off"
              inputmode="numeric"
              required
              style="
                width:100%;
                padding:12px 14px;
                margin-top:0;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                box-sizing:border-box;
              "
            />

          </div>

          ${
            this.showPayButton
              ? `
                <button
                  class="
                    ${buttonStyles.button}
                    ${buttonStyles.fullWidth}
                    ${styles.submitButton}
                  "
                  id="achForm-paymentButton"
                  type="button"
                >
                  ${
                    isGerman
                      ? 'Bezahlen'
                      : 'Pay'
                  }
                </button>
              `
              : ''
          }

        </div>

      </div>
    `;
  }
}
