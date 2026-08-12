import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod
} from '../../../payment-enabler/payment-enabler';
import { BaseComponent } from "../../base";
import styles from '../../../style/style.module.scss';
import buttonStyles from "../../../style/button.module.scss";
import {
  PaymentOutcome,
  PaymentRequestSchemaDTO,
} from "../../../dtos/mock-payment.dto";
import { BaseOptions } from "../../../payment-enabler/payment-enabler-mock";
// import { getConfig } from "../../../config/config";

export class IdealBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = true;
  constructor(private baseOptions: BaseOptions) {}

  build(config: ComponentOptions): PaymentComponent {
    return new Ideal(this.baseOptions, config);
  }
}

export class Ideal extends BaseComponent {
  private showPayButton: boolean;

  constructor(baseOptions: BaseOptions, componentOptions: ComponentOptions) {
    super(PaymentMethod.ideal, baseOptions, componentOptions);
    this.showPayButton = componentOptions?.showPayButton ?? false;
  }

  mount(selector: string) {
    document
      .querySelector(selector)
      .insertAdjacentHTML("afterbegin", this._getTemplate());

    if (this.showPayButton) {
      document
        .querySelector("#purchaseOrderForm-paymentButton")
        .addEventListener("click", (e) => {
          e.preventDefault();
          this.submit();
        });
    }
  }

  async submit() {
    this.sdk.init({ environment: this.environment });
    console.log('=== IDEAL ENABLER SUBMIT START ===');
    console.log('Environment:', this.environment);
    console.log('Processor URL:', this.processorUrl);
    console.log('Session ID:', this.sessionId);

    try {
      const requestData: PaymentRequestSchemaDTO = {
        paymentMethod: {
          type: this.paymentMethod,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      };
      console.log('Request data:', JSON.stringify(requestData, null, 2));

      console.log('Making API call to:', this.processorUrl + "/payments");
      const response = await fetch(this.processorUrl + "/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": this.sessionId,
        },
        body: JSON.stringify(requestData),
      });
      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('HTTP error response:', errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('=== PAYMENT RESPONSE ===:', JSON.stringify(data, null, 2));

      if (data.redirectUrl) {
        console.log('Redirecting to payment URL:', data.redirectUrl);
        window.location.href = data.redirectUrl;
      } else if (data.paymentReference && data.paymentReference !== 'null') {
        console.log('Payment completed with reference:', data.paymentReference);
        this.onComplete && this.onComplete({
          isSuccess: true,
          paymentReference: data.paymentReference,
        });
      } else {
        console.error('No valid payment reference received:', data.paymentReference);
        this.onError("Payment initialization failed. Please try again.");
      }

    } catch (e) {
      console.error('=== PAYMENT SUBMISSION ERROR ===:', e);
      console.error('Error details:', {
        message: e.message,
        stack: e.stack,
        name: e.name
      });
      this.onError("Some error occurred. Please try again.");
    }
  }



  private _getTemplate() {
    return this.showPayButton
      ? `
    <div class="${styles.wrapper}">
      <p>Pay easily with Ideal and transfer the shopping amount within the specified date.</p>
      <button class="${buttonStyles.button} ${buttonStyles.fullWidth} ${styles.submitButton}" id="purchaseOrderForm-paymentButton">Pay Now</button>
    </div>
    `
      : "";
  }
}
