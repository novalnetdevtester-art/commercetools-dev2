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

export class SepaBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = true;
  constructor(private baseOptions: BaseOptions) {}

  build(config: ComponentOptions): PaymentComponent {
    return new Sepa(this.baseOptions, config);
  }
}

export class Sepa extends BaseComponent {
  private showPayButton: boolean;

  constructor(baseOptions: BaseOptions, componentOptions: ComponentOptions) {
    super(PaymentMethod.sepa, baseOptions, componentOptions);
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
    // here we would call the SDK to submit the payment
    this.sdk.init({ environment: this.environment });
    console.log('submit-triggered');
    try {
      // start original
     const accountHolderInput = document.getElementById('purchaseOrderForm-poNumber') as HTMLInputElement;
    const ibanInput = document.getElementById('purchaseOrderForm-invoiceMemo') as HTMLInputElement;

    const accountHolder = accountHolderInput?.value.trim();
    const iban = ibanInput?.value.trim();

    // Validate sensitive payment data without logging
     
      const requestData: PaymentRequestSchemaDTO = {
        paymentMethod: {
          type: "DIRECT_DEBIT_SEPA",
          poNumber: accountHolder,
          invoiceMemo: iban,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      };
      // Payment request prepared
     
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
        this.onComplete &&
          this.onComplete({
            isSuccess: true,
            paymentReference: data.paymentReference,
          });
      } else {
        this.onError("Some error occurred. Please try again.");
      }

    } catch (e) {
      this.onError("Some error occurred. Please try again.");
    }
  }

private _getTemplate() {
  const payButton = this.showPayButton
    ? `<button class="${buttonStyles.button} ${buttonStyles.fullWidth} ${styles.submitButton}" id="purchaseOrderForm-paymentButton">Pay</button>`
      : "";

  return `
    <div class="${styles.wrapper}">
      <form class="${styles.paymentForm}" id="purchaseOrderForm">
        <div class="inputContainer">
          <label class="inputLabel" for="purchaseOrderForm-poNumber">
            Acoount Holder <span aria-hidden="true"> *</span>
          </label>
          <input class="inputField" type="text" id="purchaseOrderForm-poNumber" name="poNumber" value="">
          <span class="hidden errorField">Invalid PO number</span>
        </div>

        <div class="inputContainer">
          <label class="inputLabel" for="purchaseOrderForm-invoiceMemo">
            IBAN
          </label>
          <input class="inputField" type="text" id="purchaseOrderForm-invoiceMemo" name="invoiceMemo" value="">
          <span class="hidden errorField">Invalid Invoice memo</span>
        </div>

        ${payButton}
      </form>
    </div>
  `;
}

}
