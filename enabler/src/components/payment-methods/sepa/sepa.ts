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

const NOVALNET_UTILITY_CDN =
  'https://cdn.novalnet.de/js/v2/NovalnetUtility-1.1.2.js';

declare global {
  interface Window {
    NovalnetUtility?: {
      formatIban?: (
        event: Event,
        bicId?: string
      ) => void;

      checkIban?: (
        event: Event
      ) => boolean;

      formatBic?: (
        event: Event
      ) => boolean;
    };
  }
}

export class SepaBuilder
  implements PaymentComponentBuilder {

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

  /**
   * Prevent loading Novalnet Utility multiple times.
   */
  private static utilityLoadPromise:
    Promise<void> | null = null;

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
      componentOptions?.showPayButton ?? false;

    console.log(
      '[SEPA] Constructor initialized',
      {
        showPayButton:
          this.showPayButton,
      }
    );
  }

  /**
   * Load Novalnet Utility CDN.
   */
  private loadNovalnetUtility():
    Promise<void> {

    /**
     * Utility already loaded.
     */
    if (
      typeof window.NovalnetUtility !==
      'undefined'
    ) {

      console.log(
        '[SEPA] NovalnetUtility already available'
      );

      return Promise.resolve();
    }

    /**
     * Utility is already being loaded.
     */
    if (
      Sepa.utilityLoadPromise
    ) {

      console.log(
        '[SEPA] NovalnetUtility loading already in progress'
      );

      return Sepa.utilityLoadPromise;
    }

    Sepa.utilityLoadPromise =
      new Promise<void>(
        (
          resolve,
          reject
        ) => {

          console.log(
            '[SEPA] Loading NovalnetUtility CDN',
            NOVALNET_UTILITY_CDN
          );

          /**
           * Check if script already exists.
           */
          const existingScript =
            document.querySelector(
              `script[src="${NOVALNET_UTILITY_CDN}"]`
            ) as HTMLScriptElement | null;

          if (existingScript) {

            console.log(
              '[SEPA] NovalnetUtility script already exists'
            );

            if (
              typeof window.NovalnetUtility !==
              'undefined'
            ) {

              resolve();

              return;
            }

            existingScript.addEventListener(
              'load',
              () => {

                console.log(
                  '[SEPA] Existing NovalnetUtility script loaded'
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

                console.error(
                  '[SEPA] Failed to load existing NovalnetUtility script'
                );

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

          script.src =
            NOVALNET_UTILITY_CDN;

          script.async = true;

          script.onload = () => {

            console.log(
              '[SEPA] NovalnetUtility CDN loaded',
              {
                utilityAvailable:
                  typeof window.NovalnetUtility !==
                  'undefined',
              }
            );

            if (
              typeof window.NovalnetUtility ===
              'undefined'
            ) {

              reject(
                new Error(
                  'NovalnetUtility is not available after CDN load'
                )
              );

              return;
            }

            resolve();
          };

          script.onerror = () => {

            console.error(
              '[SEPA] Failed to load NovalnetUtility CDN'
            );

            reject(
              new Error(
                'Failed to load NovalnetUtility CDN'
              )
            );
          };

          document.head.appendChild(
            script
          );
        }
      ).catch(
        (error) => {

          /**
           * Allow retry if CDN loading failed.
           */
          Sepa.utilityLoadPromise =
            null;

          throw error;
        }
      );

    return Sepa.utilityLoadPromise;
  }

  mount(
    selector: string
  ) {

    console.log(
      '[SEPA] Mount started',
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
        '[SEPA] Container not found',
        {
          safeSelector,
        }
      );

      return;
    }

    /**
     * Insert SEPA template.
     */
    container.insertAdjacentHTML(
      'afterbegin',
      this._getTemplate()
    );

    console.log(
      '[SEPA] SEPA template inserted'
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
            .includes('sepa')
        ) {

          paymentLabel.textContent =
            'Direct Debit SEPA';

          console.log(
            '[SEPA] Payment label updated'
          );
        }
      },
      100
    );

    /**
     * Keep BIC container hidden initially.
     *
     * NovalnetUtility will show the BIC input
     * for countries where BIC is required.
     */
    this.setBicVisibility(
      false
    );

    /**
     * Bind IBAN events.
     */
    this.bindIbanEvents();

    /**
     * Load Novalnet Utility.
     *
     * No getconfig call is required for SEPA.
     */
    void this.loadNovalnetUtility();

    /**
     * Bind payment button.
     */
    if (
      this.showPayButton
    ) {

      const button =
        document.querySelector(
          '#sepa-payment-button'
        );

      if (button) {

        console.log(
          '[SEPA] Payment button found'
        );

        button.addEventListener(
          'click',
          (event) => {

            event.preventDefault();

            console.log(
              '[SEPA] Pay Now clicked'
            );

            void this.submit();
          }
        );

      } else {

        console.warn(
          '[SEPA] Payment button not found'
        );
      }
    }
  }

  /**
   * Bind IBAN events.
   */
  private bindIbanEvents() {

    const ibanInput =
      document.getElementById(
        'nn_sepa_account_no'
      ) as HTMLInputElement | null;

    if (!ibanInput) {

      console.warn(
        '[SEPA] IBAN input not found'
      );

      return;
    }

    console.log(
      '[SEPA] Binding IBAN events'
    );

    /**
     * IBAN change/input handler.
     */
    const handleIban =
      async (
        event: Event
      ) => {

        const input =
          event.target as
            HTMLInputElement;

        console.log(
          '[SEPA] IBAN changed',
          {
            eventType:
              event.type,

            hasValue:
              !!input?.value,

            length:
              input?.value?.length ??
              0,
          }
        );

        try {

          /**
           * Make sure Novalnet Utility
           * is available before calling it.
           */
          await this.loadNovalnetUtility();

          if (
            !window.NovalnetUtility
              ?.formatIban
          ) {

            console.warn(
              '[SEPA] NovalnetUtility.formatIban() unavailable'
            );

            return;
          }

          console.log(
            '[SEPA] Calling NovalnetUtility.formatIban()',
            {
              iban:
                input?.value ?? '',

              bicId:
                'nn_sepa_bic',
            }
          );

          /**
           * IMPORTANT:
           *
           * formatIban() does not return a boolean.
           *
           * It directly:
           * - formats the IBAN
           * - determines the country
           * - shows/hides the BIC input
           */
          window.NovalnetUtility.formatIban(
            event,
            'nn_sepa_bic'
          );

          console.log(
            '[SEPA] NovalnetUtility.formatIban() executed',
            {
              formattedIban:
                input?.value ?? '',
            }
          );

          /**
           * CDN changes the display property
           * of the BIC INPUT.
           *
           * Our BIC label is inside a separate
           * wrapper, so synchronize the wrapper
           * visibility with the input.
           */
          this.syncBicContainerVisibility();

        } catch (error) {

          console.error(
            '[SEPA] IBAN utility processing failed',
            error
          );
        }
      };

    /**
     * Handle typing.
     */
    ibanInput.addEventListener(
      'input',
      (event) => {
        void handleIban(event);
      }
    );

    /**
     * Handle field change.
     */
    ibanInput.addEventListener(
      'change',
      (event) => {
        void handleIban(event);
      }
    );

    /**
     * Restrict invalid IBAN characters
     * using Novalnet Utility.
     */
    ibanInput.addEventListener(
      'keypress',
      (event) => {

        if (
          window.NovalnetUtility
            ?.checkIban
        ) {

          const result =
            window.NovalnetUtility
              .checkIban(
                event
              );

          console.log(
            '[SEPA] checkIban() result:',
            result
          );

          if (
            result === false
          ) {

            event.preventDefault();
          }
        }
      }
    );
  }

  /**
   * Synchronize the entire BIC section
   * with the visibility of the BIC input.
   *
   * NovalnetUtility hides/shows the INPUT.
   * We also need to hide/show the LABEL.
   */
  private syncBicContainerVisibility() {

    const bicInput =
      document.getElementById(
        'nn_sepa_bic'
      ) as HTMLInputElement | null;

    const bicContainer =
      document.getElementById(
        'nn_sepa_bic_container'
      ) as HTMLElement | null;

    if (
      !bicInput ||
      !bicContainer
    ) {

      console.warn(
        '[SEPA] BIC input/container not found',
        {
          bicInput:
            !!bicInput,

          bicContainer:
            !!bicContainer,
        }
      );

      return;
    }

    /**
     * NovalnetUtility changes the input's
     * inline display style.
     */
    const computedDisplay =
      window.getComputedStyle(
        bicInput
      ).display;

    const inlineDisplay =
      bicInput.style.display;

    /**
     * BIC is visible only when the input
     * itself is visible.
     */
    const shouldShow =
      computedDisplay !== 'none' &&
      inlineDisplay !== 'none';

    bicContainer.style.display =
      shouldShow
        ? 'flex'
        : 'none';

    console.log(
      '[SEPA] BIC visibility synchronized',
      {
        computedDisplay,
        inlineDisplay,
        shouldShow,
      }
    );
  }

  /**
   * Explicitly show/hide the complete
   * BIC section including label.
   */
  private setBicVisibility(
    visible: boolean
  ) {

    const bicContainer =
      document.getElementById(
        'nn_sepa_bic_container'
      ) as HTMLElement | null;

    if (!bicContainer) {

      console.warn(
        '[SEPA] BIC container not found'
      );

      return;
    }

    bicContainer.style.display =
      visible
        ? 'flex'
        : 'none';

    console.log(
      '[SEPA] BIC container visibility set',
      {
        visible,
      }
    );
  }

  async submit() {

    console.log(
      '[SEPA] Submit started'
    );

    /**
     * Init SDK.
     */
    this.sdk.init({
      environment:
        this.environment,
    });

    const pathLocale =
      window.location.pathname
        .split('/')[1];

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
          'nn_account_holder'
        ) as HTMLInputElement;

      const ibanInput =
        document.getElementById(
          'nn_sepa_account_no'
        ) as HTMLInputElement;

      const bicInput =
        document.getElementById(
          'nn_sepa_bic'
        ) as HTMLInputElement;

      const accountHolder =
        accountHolderInput
          ?.value
          ?.trim() ?? '';

      /**
       * NovalnetUtility formats IBAN
       * with spaces visually.
       *
       * Remove spaces before sending
       * the payment request.
       */
      const iban =
        ibanInput
          ?.value
          ?.replace(/\s/g, '')
          ?.trim() ?? '';

      const bic =
        bicInput
          ?.value
          ?.replace(/\s/g, '')
          ?.trim() ?? '';

      console.log(
        '[SEPA] Form values',
        {
          accountHolderAvailable:
            !!accountHolder,

          ibanAvailable:
            !!iban,

          ibanLength:
            iban.length,

          bicAvailable:
            !!bic,

          bicLength:
            bic.length,
        }
      );

      /**
       * Account holder validation.
       */
      if (!accountHolder) {

        console.warn(
          '[SEPA] Account holder validation failed'
        );

        this.onError(
          'Please enter account holder name'
        );

        return;
      }

      /**
       * IBAN validation.
       */
      if (!iban) {

        console.warn(
          '[SEPA] IBAN validation failed'
        );

        this.onError(
          'Please enter IBAN'
        );

        return;
      }

      /**
       * Payment request.
       */
      const requestData:
        PaymentRequestSchemaDTO = {

        paymentMethod: {

          type:
            'DIRECT_DEBIT_SEPA',

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
          pathLocale ?? 'de',

        path:
          baseSiteUrl,
      };

      console.log(
        '[SEPA] Payment request prepared',
        {
          paymentMethod:
            requestData.paymentMethod.type,

          paymentOutcome:
            requestData.paymentOutcome,

          lang:
            requestData.lang,

          path:
            requestData.path,

          ibanLength:
            iban.length,

          bicProvided:
            !!bic,
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
        '[SEPA] Payment API response',
        {
          status:
            response.status,

          ok:
            response.ok,
        }
      );

      /**
       * HTTP error.
       */
      if (!response.ok) {

        const errorText =
          await response.text();

        console.error(
          '[SEPA] HTTP error response',
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
        '[SEPA] Payment response',
        data
      );

      /**
       * Payment success.
       */
      if (
        data?.paymentReference
      ) {

        console.log(
          '[SEPA] Payment successful',
          {
            paymentReference:
              data.paymentReference,
          }
        );

        this.onComplete?.({
          isSuccess:
            true,

          paymentReference:
            data.paymentReference,
        });

        return;
      }

      /**
       * Payment failure.
       */
      console.error(
        '[SEPA] Payment failed',
        {
          response:
            data,
        }
      );

      this.onError(
        data?.transactionStatusText ||
          'Some error occurred. Please try again.'
      );

    } catch (
      error: any
    ) {

      console.error(
        '[SEPA] Submit error',
        {
          message:
            error?.message,

          stack:
            error?.stack,

          error,
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
            id="sepa-payment-button"
            type="button"
          >
            Pay Now
          </button>
        `
        : '';

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
                width:100%;
                box-sizing:border-box;
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
              spellcheck="false"
              style="
                padding:12px 14px;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                text-transform:uppercase;
                width:100%;
                box-sizing:border-box;
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
              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="nn_sepa_bic"
              name="nn_sepa_bic"
              autocomplete="off"
              spellcheck="false"
              style="
                padding:12px 14px;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                width:100%;
                box-sizing:border-box;
              "
            />

          </div>

          ${payButton}

        </div>

      </div>
    `;
  }
}
