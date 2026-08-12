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
} from "../../../dtos/mock-payment.dto";
import { BaseOptions } from "../../../payment-enabler/payment-enabler-mock";

export class CreditcardBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = true;

  constructor(private baseOptions: BaseOptions) {}

  build(config: ComponentOptions): PaymentComponent {
    return new Creditcard(this.baseOptions, config);
  }
}

export class Creditcard extends BaseComponent {
  private showPayButton: boolean;

  constructor(baseOptions: BaseOptions, componentOptions: ComponentOptions) {
    super(PaymentMethod.creditcard, baseOptions, componentOptions);
    this.showPayButton = componentOptions?.showPayButton ?? false;
  }

  mount(selector: string) {
    const root = document.querySelector(selector);
    if (!root) {
      console.error("Mount selector not found:", selector);
      return;
    }

    root.insertAdjacentHTML("afterbegin", this._getTemplate());

    const payButton = document.querySelector(
      "#purchaseOrderForm-paymentButton"
    ) as HTMLButtonElement | null;

    if (this.showPayButton && payButton) {
      payButton.disabled = true;
      payButton.addEventListener("click", async (e) => {
        e.preventDefault();
        await this.submit();
      });
    }

    this._loadNovalnetScriptOnce()
      .then(() => this._initNovalnetCreditCardForm(payButton))
      .catch((err) => console.error("Failed to load Novalnet SDK:", err));

    const reviewOrderButton = document.querySelector(
      '[data-ctc-selector="confirmMethod"]'
    );
    if (reviewOrderButton) {
      reviewOrderButton.addEventListener("click", async (event) => {
        event.preventDefault();
        const NovalnetUtility = (window as any).NovalnetUtility;
        if (NovalnetUtility?.getPanHash) {
          try {
            console.log("Calling NovalnetUtility.getPanHash()");
            await NovalnetUtility.getPanHash();
          } catch (error) {
            console.error("Error getting pan hash:", error);
          }
        } else {
          console.warn("NovalnetUtility.getPanHash() not available.");
        }
      });
    }
  }

  async submit() {
    this.sdk.init({ environment: this.environment });

    try {
      const panhashInput = document.getElementById("pan_hash") as HTMLInputElement;
      const uniqueIdInput = document.getElementById("unique_id") as HTMLInputElement;
      const doRedirectInput = document.getElementById("do_redirect") as HTMLInputElement;
      
      const panhash = panhashInput?.value.trim();
      const uniqueId = uniqueIdInput?.value.trim();
      const doRedirect = doRedirectInput?.value.trim();

      console.log("PAN HASH:", panhash);
      console.log("UNIQUE ID:", uniqueId);
      console.log("DO REDIRECT:", doRedirect);
      
      if (!panhash || !uniqueId) {
        this.onError("Credit card information is missing or invalid.");
        return;
      }

      const requestData: PaymentRequestSchemaDTO = {
        paymentMethod: {
          type: "CREDITCARD",
          panHash: panhash,
          uniqueId: uniqueId,
          doRedirect: doRedirect,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      };

      const response = await fetch(this.processorUrl + "/payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": this.sessionId,
        },
        body: JSON.stringify(requestData),
      });

      const data = await response.json();
      if (data.paymentReference) {
        this.onComplete?.({
          isSuccess: true,
          paymentReference: data.paymentReference,
        });
      } else {
        this.onError("Payment failed. Please try again.");
      }
    } catch (e) {
      console.error(e);
      this.onError("Some error occurred. Please try again.");
    }
  }

  private _getTemplate() {
    const payButton = this.showPayButton
      ? `<button class="${buttonStyles.button} ${buttonStyles.fullWidth} ${styles.submitButton}" id="purchaseOrderForm-paymentButton">Pay</button>`
      : "";

    return `
      <div class="${styles.wrapper}">
          <iframe id="novalnet_iframe" frameborder="0" scrolling="no"></iframe>
          <input type="hidden" id="pan_hash" name="pan_hash"/>
          <input type="hidden" id="unique_id" name="unique_id"/>
          <input type="hidden" id="do_redirect" name="do_redirect"/>
          ${payButton}
      </div>
    `;
  }

  private async _loadNovalnetScriptOnce(): Promise<void> {
    if ((window as any).NovalnetUtility) return;

    const src = "https://cdn.novalnet.de/js/v2/NovalnetUtility-1.1.2.js";
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;

    if (existing) {
      if ((existing as any)._nnLoadingPromise) {
        await (existing as any)._nnLoadingPromise;
        return;
      }
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.crossOrigin = "anonymous";

    const loadPromise = new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = (e) => reject(e);
    });

    (script as any)._nnLoadingPromise = loadPromise;
    document.head.appendChild(script);
    await loadPromise;
  }

  private _initNovalnetCreditCardForm(payButton: HTMLButtonElement | null) {
    const NovalnetUtility = (window as any).NovalnetUtility;
    if (!NovalnetUtility) {
      console.warn("NovalnetUtility not available.");
      return;
    }

    NovalnetUtility.setClientKey("88fcbbceb1948c8ae106c3fe2ccffc12");

    const configurationObject = {
      callback: {
        on_success: (data: any) => {
          (document.getElementById("pan_hash") as HTMLInputElement).value = data["hash"];
          (document.getElementById("unique_id") as HTMLInputElement).value = data["unique_id"];
          (document.getElementById("do_redirect") as HTMLInputElement).value = data["do_redirect"];
          if (payButton) payButton.disabled = false;
          payButton.click(); 
          return true;
        },
        on_error: (data: any) => {
          if (data?.error_message) {
            alert(data.error_message);
          }
          if (payButton) payButton.disabled = true;
          return false;
        },
        on_show_overlay: () => {
          document.getElementById("novalnet_iframe")?.classList.add("overlay");
        },
        on_hide_overlay: () => {
          document.getElementById("novalnet_iframe")?.classList.remove("overlay");
        },
      },
      iframe: {
        id: "novalnet_iframe",
        inline: 1,
        style: { container: "", input: "", label: "" },
        text: {
          lang: "EN",
          error: "Your credit card details are invalid",
          card_holder: {
            label: "Card holder name",
            place_holder: "Name on card",
            error: "Please enter the valid card holder name",
          },
          card_number: {
            label: "Card number",
            place_holder: "XXXX XXXX XXXX XXXX",
            error: "Please enter the valid card number",
          },
          expiry_date: {
            label: "Expiry date",
            error: "Please enter the valid expiry month / year in the given format",
          },
          cvc: {
            label: "CVC/CVV/CID",
            place_holder: "XXX",
            error: "Please enter the valid CVC/CVV/CID",
          },
        },
      },
      customer: {
        first_name: "Max",
        last_name: "Mustermann",
        email: "test@novalnet.de",
        billing: {
          street: "Musterstr, 2",
          city: "Musterhausen",
          zip: "12345",
          country_code: "DE",
        },
        shipping: {
          same_as_billing: 1,
          first_name: "Max",
          last_name: "Mustermann",
          email: "test@novalnet.de",
          street: "Hauptstr, 9",
          city: "Kaiserslautern",
          zip: "66862",
          country_code: "DE",
        },
      },
      transaction: {
        amount: 123,
        currency: "EUR",
        test_mode: 1,
      },
      custom: {
        lang: "EN",
      },
    };

    NovalnetUtility.createCreditCardForm(configurationObject);
  }
}
