import { appLogger, paymentSDK } from "../payment-sdk";
import { log } from "../libs/logger";
import { projectApiRoot } from "../utils/ct-client";
import { SupportedLocale, t } from "../i18n";
import { PaymentUpdateAction } from "@commercetools/platform-sdk";

export class NovalnetPaymentCommonService {
  constructor(
    private readonly ctPaymentService: any,
    private readonly ctCartService: any,
  ) {}


  private resolvePrimaryTransaction(
    payment: any,
    pspReference: string,
    preferredType?: "Authorization" | "Charge",
  ) {
    const txs = payment.transactions ?? [];
    for (const id of [`${pspReference}-Charge`, pspReference]) {
      const tx = [...txs].reverse().find((t:any)=>
        t.interactionId===id && (!preferredType || t.type===preferredType)
      );
      if (tx) return tx;
    }
    return [...txs].reverse().find((t:any)=>t.interactionId===pspReference);
  }
private async updatePaymentTransaction({
  paymentId,
  pspReference,
  transactionComments,
  statusCode,
  state,
  appendComments = true,
  setCustomType = false,
  setStatusInterfaceCode = true,
  changeTransactionState = true,
  errorMessage = "Transaction not found",
}: {
  paymentId: string;
  pspReference: string;
  transactionComments: string;
  statusCode?: string;
  state?: "Initial" | "Pending" | "Success" | "Failure";
  appendComments?: boolean;
  setCustomType?: boolean;
  setStatusInterfaceCode?: boolean;
  changeTransactionState?: boolean;
  errorMessage?: string;
}) {

  const raw =
    await this.ctPaymentService.getPayment({
      id: paymentId,
    } as any);

  const payment = (raw as any)?.body ?? raw;

  const tx = payment.transactions?.find(
    (transaction: any) =>
      transaction.interactionId === pspReference,
  );

  if (!tx?.id) {
    log.error("[PAYMENT_TX] Transaction not found", {
      paymentId,
      pspReference,
    });

    throw new Error(errorMessage);
  }

  const existingComments =
    tx.custom?.fields?.transactionComments ?? "";

  const currentInterfaceCode =
    payment.paymentStatus?.interfaceCode ?? "";

  const alreadyUpdated =
    tx.state === state &&
    currentInterfaceCode === String(statusCode ?? "") &&
    existingComments === transactionComments;

  if (alreadyUpdated) {

    log.info("[PAYMENT_TX] Already updated", {
      paymentId,
      transactionId: tx.id,
    });

    return {
      txId: tx.id,
      comments: existingComments,
    };
  }

  const finalComments =
    appendComments && existingComments
      ? `${existingComments}\n\n---\n${transactionComments}`
      : transactionComments;

  const actions: PaymentUpdateAction[] = [];

  if (setCustomType && !tx.custom?.type) {
    actions.push({
      action: "setTransactionCustomType",
      transactionId: tx.id,
      type: {
        key: "novalnet-custom-field",
        typeId: "type",
      },
    });
  }

  if (existingComments !== finalComments) {
    actions.push({
      action: "setTransactionCustomField",
      transactionId: tx.id,
      name: "transactionComments",
      value: finalComments,
    });
  }
  
  if (
    setStatusInterfaceCode &&
    currentInterfaceCode !== String(statusCode ?? "")
  ) {
    actions.push({
      action: "setStatusInterfaceCode",
      interfaceCode: String(statusCode ?? ""),
    });
  }
  
  if (
    changeTransactionState &&
    state &&
    tx.state !== state
  ) {
    actions.push({
      action: "changeTransactionState",
      transactionId: tx.id,
      state,
    });
  }

    if (actions.length === 0) {
  
    log.info("[PAYMENT_TX] Already synchronized", {
      paymentId,
      transactionId: tx.id,
      transactionState: tx.state,
      interfaceCode: currentInterfaceCode,
    });
  
    return {
      txId: tx.id,
      comments: existingComments,
    };
  }

  log.info("[PAYMENT_TX] Updating Payment", {
    paymentId,
    transactionId: tx.id,
    actions: actions.map(a => a.action),
  });

  await projectApiRoot
    .payments()
    .withId({ ID: paymentId })
    .post({
      body: {
        version: payment.version,
        actions,
      },
    })
    .execute();

  log.info("[PAYMENT_TX] Payment updated", {
    paymentId,
    transactionId: tx.id,
  });

  return {
    txId: tx.id,
    comments: finalComments,
  };
}

private async processWebhookTransaction({
  webhook,
  transactionComments,
  state,
  setStatusInterfaceCode = true,
  changeTransactionState = true,
  skipSettlement = false,
}: {
  webhook: any;
  transactionComments: string;
  state?: "Initial" | "Pending" | "Success" | "Failure";
  setStatusInterfaceCode?: boolean;
  changeTransactionState?: boolean;
  skipSettlement?: boolean;
}) {

  const paymentId =
    webhook.custom?.["ctpayment-id"] ??
    webhook.custom?.inputval1;

  const pspReference =
    webhook.custom?.pspReference ??
    webhook.custom?.inputval2;

  const status = String(
    webhook.transaction?.status ?? "",
  ).toUpperCase();

  const mapped = this.getTransactionStatus(status);
  const effectiveState = state ?? mapped.state;

  log.info("[WEBHOOK_TX] START", {
    paymentId,
    pspReference,
    eventType: webhook.event?.type,
    status,
  });

  await this.updatePaymentTransaction({
    paymentId,
    pspReference,
    transactionComments,
    statusCode: webhook.transaction?.status_code,
    state: effectiveState,
    setStatusInterfaceCode,
    changeTransactionState,
  });

  if (!skipSettlement &&
      mapped.transactionType !== "CancelAuthorization") {

    log.info("[WEBHOOK_TX] Settlement validation", {
      paymentId,
      transactionType: mapped.transactionType,
    });

    await this.addSettlementTransactionIfRequired({
      paymentId,
      pspReference,
      amount: webhook.transaction?.amount,
      currency: webhook.transaction?.currency,
      transactionType: mapped.transactionType,
      status,
    });
  }

  await this.syncPaymentToOrder(paymentId, pspReference);

  log.info("[WEBHOOK_TX] COMPLETED", {
    paymentId,
    pspReference,
  });

  return transactionComments;
}
}
