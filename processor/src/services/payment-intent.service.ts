import {
  CommercetoolsPaymentService,
} from "@commercetools/connect-payments-sdk";
import { Payment } from "@commercetools/platform-sdk";
import JSONbig from "json-bigint";
import { getConfig } from "../config/config";
import {
  PaymentIntentRequestSchemaDTO,
  PaymentIntentResponseSchemaDTO,
  PaymentModificationStatus,
} from "../dtos/operations/payment-intents.dto";
import customObjectService from "./ct-custom-object.service";
import { log } from "../libs/logger";

const BASE_URL = "https://payport.novalnet.de/v2";

type Action = PaymentIntentRequestSchemaDTO["actions"][number];

type Money = {
  centAmount: number;
  currencyCode: string;
};

type NovalnetReply = {
  result?: {
    status?: string;
    status_text?: string;
    status_code?: number | string;
  };

  transaction?: {
    tid?: string;
    status?: string;
    amount?: string;
    currency?: string;
  };

  refund?: {
    tid?: string;
    status?: string;
  };
};

function assertRequest(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function getTransactions(payment: Payment) {
  return payment.transactions ?? [];
}

function sumTransactions(payment: Payment, type: string): number {
  return getTransactions(payment)
    .filter(
      (tx) =>
        tx.type === type &&
        tx.state === "Success",
    )
    .reduce(
      (sum, tx) => sum + tx.amount.centAmount,
      0,
    );
}

function validate(payment: Payment, action: Action) {
  const transactions = getTransactions(payment);

  const authorized = transactions
    .filter(
      (tx) =>
        tx.type === "Authorization" &&
        (tx.state === "Success" ||
          tx.state === "Pending"),
    )
    .reduce(
      (sum, tx) => sum + tx.amount.centAmount,
      0,
    );

  const charged = sumTransactions(payment, "Charge");
  const refunded = sumTransactions(payment, "Refund");
  const cancelled =
    sumTransactions(payment, "CancelAuthorization") > 0;

  log.info("[PAYMENT_INTENT][VALIDATE]", {
    paymentId: payment.id,
    action: action.action,
    authorized,
    charged,
    refunded,
    cancelled,
  });

  switch (action.action) {
    case "capturePayment":
      assertRequest(
        authorized > 0,
        "No active authorization.",
      );
      assertRequest(
        !cancelled,
        "Authorization already cancelled.",
      );
      assertRequest(
        charged === 0,
        "Already captured.",
      );
      assertRequest(
        action.amount.centAmount === authorized,
        "Novalnet requires full authorization capture.",
      );
      break;

    case "refundPayment":
      assertRequest(
        charged > 0,
        "No captured payment found.",
      );
      assertRequest(
        action.amount.centAmount <=
          charged - refunded,
        "Refund exceeds remaining amount.",
      );
      break;

    case "cancelPayment":
    case "reversePayment":
      assertRequest(
        authorized > 0 &&
          charged === 0 &&
          !cancelled,
        "Authorization cannot be cancelled.",
      );
      break;
  }

  if ("amount" in action) {
    const amount = action.amount as Money;

    assertRequest(
      Number.isSafeInteger(amount.centAmount) &&
        amount.centAmount > 0,
      "Invalid amount.",
    );

    assertRequest(
      amount.currencyCode ===
        payment.amountPlanned.currencyCode,
      "Currency mismatch.",
    );
  }
}

async function callNovalnet(
  endpoint: string,
  payload: object,
): Promise<NovalnetReply> {
  const accessKey =
    getConfig().novalnetPrivateKey;

  assertRequest(
    accessKey,
    "Novalnet Access Key is missing.",
  );

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    30000,
  );

  log.info("[NOVALNET][REQUEST]", {
    endpoint,
    payload,
  });

  try {
    const response = await fetch(
      `${BASE_URL}${endpoint}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type":
            "application/json",
          Accept: "application/json",
          "X-NN-Access-Key":
            Buffer.from(accessKey).toString(
              "base64",
            ),
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Novalnet HTTP ${response.status}`,
      );
    }

    const parsed = JSONbig({
      storeAsString: true,
    }).parse(await response.text());

    const body = JSON.parse(
      JSON.stringify(parsed),
    ) as NovalnetReply;

    log.info("[NOVALNET][RESPONSE]", {
      apiStatus: body.result?.status,
      transactionStatus:
        body.transaction?.status,
      statusCode:
        body.result?.status_code,
      tid: body.transaction?.tid,
    });

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function executePaymentIntent(
  ctPaymentService: CommercetoolsPaymentService,
  paymentId: string,
  data: PaymentIntentRequestSchemaDTO,
): Promise<PaymentIntentResponseSchemaDTO> {
  log.info("[PAYMENT_INTENT][START]", {
    paymentId,
    actions: data.actions,
  });

  assertRequest(
    data.actions.length === 1,
    "Exactly one action required.",
  );

  const action = data.actions[0];

  const raw =
    await ctPaymentService.getPayment({
      id: paymentId,
    });

  const payment = ((raw as any).body ??
    raw) as Payment;

  log.info("[PAYMENT_INTENT][PAYMENT_FOUND]", {
    paymentId: payment.id,
    plannedAmount: payment.amountPlanned,
    transactionCount:
      payment.transactions?.length ?? 0,
  });

  validate(payment, action);

  const original =
    [...getTransactions(payment)]
      .reverse()
      .find(
        (tx) =>
          tx.type === "Authorization" &&
          (tx.state === "Success" ||
            tx.state === "Pending"),
      ) ??
    [...getTransactions(payment)]
      .reverse()
      .find((tx) => tx.type === "Charge");

  assertRequest(
    original?.interactionId,
    "Payment reference missing.",
  );

  log.info(
    "[PAYMENT_INTENT][ORIGINAL_TRANSACTION]",
    {
      paymentId,
      interactionId:
        original.interactionId,
      transactionType: original.type,
      transactionState: original.state,
    },
  );

  const key = `${payment.id}-${original.interactionId}`;

  log.info(
    "[PAYMENT_INTENT][CUSTOM_OBJECT]",
    {
      key,
    },
  );

  const privateData =
    await customObjectService.get(
      "nn-private-data",
      key,
    );

  assertRequest(
    privateData?.value,
    "Private payment data not found.",
  );

  const tid = String(
    privateData.value.tid,
  );

  assertRequest(
    /^\d+$/.test(tid),
    "Novalnet TID missing.",
  );

  let endpoint = "/transaction/capture";

  const transaction: Record<
    string,
    any
  > = {
    tid,
  };

  switch (action.action) {
    case "capturePayment":
      endpoint = "/transaction/capture";
      break;

    case "refundPayment":
      endpoint = "/transaction/refund";
      transaction.amount =
        action.amount.centAmount;
      break;

    case "cancelPayment":
    case "reversePayment":
      endpoint = "/transaction/cancel";
      break;
  }

  log.info(
    "[PAYMENT_INTENT][ACTION_MAPPING]",
    {
      action: action.action,
      endpoint,
      tid,
      amount:
        "amount" in action
          ? action.amount
          : undefined,
    },
  );

  const response = await callNovalnet(
    endpoint,
    { transaction },
  );

  const apiStatus = String(
    response.result?.status ?? "",
  ).toUpperCase();

  if (apiStatus !== "SUCCESS") {
    log.error(
      "[PAYMENT_INTENT][API_FAILED]",
      {
        paymentId,
        endpoint,
        tid,
        apiStatus,
        response,
      },
    );

    throw new Error(
      response.result?.status_text ??
        "Novalnet API request failed.",
    );
  }

  const transactionStatus = String(
    response.transaction?.status ?? "",
  ).toUpperCase();

  log.info("[PAYMENT_INTENT][PSP_RESULT]", {
    paymentId,
    endpoint,
    tid,
    apiStatus,
    transactionStatus,
  });

  switch (transactionStatus) {
    case "CONFIRMED":
    case "DEACTIVATED":
    case "SUCCESS":
      return {
        outcome:
          PaymentModificationStatus.APPROVED,
        paymentReference: payment.id,
      };

    case "PENDING":
      return {
        outcome:
          PaymentModificationStatus.RECEIVED,
        paymentReference: payment.id,
      };

    case "FAILURE":
      return {
        outcome:
          PaymentModificationStatus.REJECTED,
        paymentReference: payment.id,
      };

    default:
      log.warn(
        "[PAYMENT_INTENT][UNKNOWN_TRANSACTION_STATUS]",
        {
          paymentId,
          endpoint,
          tid,
          transactionStatus,
          response,
        },
      );

      return {
        outcome:
          PaymentModificationStatus.RECEIVED,
        paymentReference: payment.id,
      };
  }
}
