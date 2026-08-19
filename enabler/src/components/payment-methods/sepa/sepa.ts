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

/**
 * Novalnet Utility CDN
 */
const NOVALNET_UTILITY_CDN =
  'https://cdn.novalnet.de/js/v2/NovalnetUtility-1.1.2.js';

/**
 * Global NovalnetUtility type
 *
 * Only the functions used by this payment enabler
 * are defined here.
 */
declare global {
  interface Window {
    NovalnetUtility?: {
      setClientKey?: (clientKey: string) => boolean;

      formatIban?: (
        event: Event,
        bicId?: string
      ) => void;

      checkIban?: (event: Event) => boolean;

      formatBic?: (event: Event) => boolean;
    };
  }
}

export class SepaBuilder implements PaymentComponentBuilder {
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
   * Prevent loading the CDN multiple times.
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
        showPayButton: this.showPayButton,
        processorUrl: this.processorUrl,
        sessionId: this.sessionId,
        environment: this.environment,
      }
    );
  }

  /**
   * Load Novalnet Utility CDN.
   */
  private loadNovalnetUtility(): Promise<void> {
    /**
     * Already available.
     */
    if (
      typeof window.NovalnetUtility !== 'undefined'
    ) {
      console.log(
        '[SEPA] NovalnetUtility already available'
      );

      return Promise.resolve();
    }

    /**
     * Already loading.
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
        (resolve, reject) => {
          console.log(
            '[SEPA] Loading NovalnetUtility CDN:',
            NOVALNET_UTILITY_CDN
          );

          /**
           * Avoid adding duplicate script.
           */
          const existingScript =
            document.querySelector(
              `script[src="${NOVALNET_UTILITY_CDN}"]`
            ) as HTMLScriptElement | null;

          if (existingScript) {
            console.log(
              '[SEPA] NovalnetUtility script already exists in DOM'
            );

            existingScript.addEventListener(
              'load',
              () => {
                console.log(
                  '[SEPA] NovalnetUtility CDN loaded'
                );

                resolve();
              },
              { once: true }
            );

            existingScript.addEventListener(
              'error',
              () => {
                console.error(
                  '[SEPA] Failed to load NovalnetUtility CDN'
                );

                reject(
                  new Error(
                    'Failed to load NovalnetUtility'
                  )
                );
              },
              { once: true }
            );

            return;
          }

          const script =
            document.createElement('script');

          script.src =
            NOVALNET_UTILITY_CDN;

          script.async = true;

          script.onload = () => {
            console.log(
              '[SEPA] NovalnetUtility CDN loaded successfully',
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
      ).catch((error) => {
        /**
         * Allow another attempt if loading failed.
         */
        Sepa.utilityLoadPromise = null;

        throw error;
      });

    return Sepa.utilityLoadPromise;
  }

  /**
   * Initialize Novalnet Utility.
   */
  private async initializeNovalnetUtility(): Promise<void> {
    try {
      await this.loadNovalnetUtility();

      console.log(
        '[SEPA] Initializing NovalnetUtility',
        {
          utilityAvailable:
            typeof window.NovalnetUtility !==
            'undefined',
        }
      );

      if (
        !window.NovalnetUtility
      ) {
        console.error(
          '[SEPA] NovalnetUtility unavailable'
        );

        return;
      }

      /**
       * Get client key from processor.
       */
      const response =
        await fetch(
          this.processorUrl +
            '/getconfig',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              'X-Session-Id':
                this.sessionId,
            },
          }
        );

      if (!response.ok) {
        console.error(
          '[SEPA] Failed to fetch Novalnet config',
          {
            status: response.status,
          }
        );

        return;
      }

      const config =
        await response.json();

      console.log(
        '[SEPA] Novalnet config received',
        {
          clientKeyAvailable:
            !!config?.paymentReference,
        }
      );

      const clientKey =
        String(
          config?.paymentReference ?? ''
        );

      if (!clientKey) {
        console.error(
          '[SEPA] Client key missing from config'
        );

        return;
      }

      if (
        typeof window.NovalnetUtility
          .setClientKey ===
        'function'
      ) {
        const result =
          window.NovalnetUtility
            .setClientKey(
              clientKey
            );

        console.log(
          '[SEPA] NovalnetUtility.setClientKey() result:',
          result
        );
      } else {
        console.warn(
          '[SEPA] setClientKey() is not available'
        );
      }
    } catch (error) {
      console.error(
        '[SEPA] NovalnetUtility initialization failed',
        error
      );
    }
  }

  mount(selector: string) {
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

    console.log(
      '[SEPA] Safe selector:',
      safeSelector
    );

    const container =
      document.querySelector(
        safeSelector
      );

    if (!container) {
      console.error(
        '[SEPA] Container not found:',
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
      '[SEPA] SEPA template inserted'
    );

    /**
     * Update only current payment label.
     */
    setTimeout(() => {
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
    }, 100);

    /**
     * Bind IBAN functionality.
     */
    this.bindIbanEvents();

    /**
     * Initialize Novalnet Utility.
     */
    void this.initializeNovalnetUtility();

    /**
     * Bind payment button.
     */
    if (this.showPayButton) {
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
          (e) => {
            e.preventDefault();

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
   * Bind IBAN input events.
   *
   * NovalnetUtility.formatIban() directly updates
   * the IBAN field and BIC visibility.
   *
   * It does NOT return a boolean.
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
     * Handle IBAN changes.
     */
    const handleIban = (
      event: Event
    ) => {
      const input =
        event.target as HTMLInputElement;

      console.log(
        '[SEPA] IBAN changed',
        {
          eventType: event.type,
          hasValue:
            !!input?.value,
          length:
            input?.value?.length ?? 0,
          value:
            input?.value ?? '',
        }
      );

      /**
       * NovalnetUtility directly formats the IBAN
       * and controls BIC visibility.
       *
       * Do NOT check the return value.
       */
      if (
        window.NovalnetUtility &&
        typeof window.NovalnetUtility
          .formatIban ===
          'function'
      ) {
        console.log(
          '[SEPA] Calling NovalnetUtility.formatIban()'
        );

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
      } else {
        console.warn(
          '[SEPA] NovalnetUtility.formatIban() unavailable'
        );
      }

      /**
       * Log BIC visibility after utility processing.
       */
      const bicInput =
        document.getElementById(
          'nn_sepa_bic'
        ) as HTMLInputElement | null;

      console.log(
        '[SEPA] BIC state after IBAN processing',
        {
          bicExists:
            !!bicInput,

          bicDisplay:
            bicInput
              ? bicInput.style.display
              : 'not-found',

          iban:
            input?.value ?? '',
        }
      );
    };

    /**
     * Change event.
     */
    ibanInput.addEventListener(
      'change',
      handleIban
    );

    /**
     * Input event gives a better UX while typing.
     */
    ibanInput.addEventListener(
      'input',
      handleIban
    );

    /**
     * Keypress is supported by the original
     * NovalnetUtility implementation.
     */
    ibanInput.addEventListener(
      'keypress',
      (event) => {
        if (
          window.NovalnetUtility &&
          typeof window.NovalnetUtility
            .checkIban ===
            'function'
        ) {
          const result =
            window.NovalnetUtility
              .checkIban(
                event
              );

          console.log(
            '[SEPA] NovalnetUtility.checkIban() result:',
            result
          );

          if (result === false) {
            event.preventDefault();
          }
        }
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
        accountHolderInput?.value
          ?.trim() ?? '';

      /**
       * Remove spaces before sending IBAN.
       *
       * NovalnetUtility formats it visually
       * with spaces, but the payment request
       * should contain the actual IBAN.
       */
      const iban =
        ibanInput?.value
          ?.replace(/\s/g, '')
          ?.trim() ?? '';

      const bic =
        bicInput?.value
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
       * Basic validation.
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
       * Request payload.
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

          /**
           * Do not log complete IBAN/BIC.
           */
          ibanLength:
            iban.length,

          bicProvided:
            !!bic,
        }
      );

      /**
       * API request.
       */
      const response =
        await fetch(
          this.processorUrl +
            '/directPayment',
          {
            method: 'POST',

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
       * Validate response.
       */
      if (!response.ok) {
        const errorText =
          await response.text();

        console.error(
          '[SEPA] HTTP error response:',
          errorText
        );

        throw new Error(
          `HTTP error! status: ${response.status}`
        );
      }

      const data =
        await response.json();

      console.log(
        '[SEPA] SEPA payment response:',
        data
      );

      /**
       * Success.
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
          isSuccess: true,

          paymentReference:
            data.paymentReference,
        });
      } else {
        console.error(
          '[SEPA] Payment failed - paymentReference missing',
          {
            response:
              data,
          }
        );

        this.onError(
          data?.transactionStatusText ||
            'Some error occurred. Please try again.'
        );
      }
    } catch (e: any) {
      console.error(
        '[SEPA] Submit error',
        {
          message:
            e?.message,

          stack:
            e?.stack,

          error:
            e,
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
            style="
              display:flex;
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
