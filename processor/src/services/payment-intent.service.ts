
async function saveRefund(payment: Payment, reference: Reference,
  reply: NovalnetReply, amount: number): Promise<boolean> {
  const refund = reply.transaction?.refund ?? reply.refund;
  const refundTid = String(refund?.tid ?? "");
  if (!/^\d+$/.test(refundTid)) {
    log.warn("[PAYMENT_INTENT] Refund accepted without refund TID; awaiting reconciliation", {
      paymentId: payment.id, tid: reference.tid,
    });
    return false; // Never invent a refund ID: the webhook deduplicates by this TID.
  }
  if (refund?.amount != null && Number(refund.amount) !== amount) {
    throw new Error("Novalnet refund amount differs from the requested amount.");
  }
  if (reply.transaction?.refunded_amount != null) {
    const reportedTotal = Number(reply.transaction.refunded_amount);
    requireValue(Number.isSafeInteger(reportedTotal) &&
      reportedTotal <= sum(payment, "Charge") && reportedTotal >= amount,
      "Invalid Novalnet total refunded amount.");
  }
  const currency = refund?.currency ?? reply.transaction?.currency ?? payment.amountPlanned.currencyCode;
  requireValue(currency === payment.amountPlanned.currencyCode, "Novalnet refund currency mismatch.");
  await createTransactionCommentsType();
  const root = projectApiRoot.payments().withId({ ID: payment.id });
  const latest = (await root.get().execute()).body;
  const existing = latest.transactions.find((tx) => tx.type === "Refund" && tx.interactionId === refundTid);
  if (existing) {
    requireValue(existing.amount.centAmount === amount && existing.amount.currencyCode === currency,
      "Refund TID already belongs to another amount.");
  }
  const comment = commentFor("refund", latest, reference, amount, refundTid);
  const actions: PaymentUpdateAction[] = [];
  if (!existing) {
    actions.push({ action: "addTransaction", transaction: {
      type: "Refund", amount: { centAmount: amount, currencyCode: currency },
      state: "Success", interactionId: refundTid,
      custom: {
        type: { key: "novalnet-custom-field", typeId: "type" },
        fields: { transactionComments: comment },
      },
    } });
  } else if (existing.state !== "Success") {
    actions.push({ action: "changeTransactionState", transactionId: existing.id, state: "Success" });
  }
  const statusCode = reply.transaction?.status_code ?? reply.result?.status_code;
  if (statusCode != null && latest.paymentStatus?.interfaceCode !== String(statusCode)) {
    actions.push({ action: "setStatusInterfaceCode", interfaceCode: String(statusCode) });
  }
  if (actions.length) await root.post({ body: { version: latest.version, actions } }).execute();

  // Match the fields written by handleTransactionRefund. Preserve the private
  // data not related to the refund (and the original TID needed for future calls).
  try {
    const refundedAmount = sum(latest, "Refund") + (existing?.state === "Success" ? 0 : amount);
    await customObjectService.upsert("nn-private-data", `${payment.id}-${reference.pspReference}`, {
      ...reference.privateData,
      tid: reference.tid,
      status: reply.transaction?.status ?? reference.privateData.status,
      refundedAmount: reply.transaction?.refunded_amount ?? refundedAmount,
      lastRefundTid: refundTid,
      lastRefundAmount: amount,
      additionalInfo: {
        ...(reference.privateData.additionalInfo ?? {}), comments: comment,
      },
    });
  } catch (error) {
    log.error("[PAYMENT_INTENT] Refund saved, private-data sync failed", {
      paymentId: payment.id, refundTid, error,
    });
  }
  try {
    await syncOrderComment(payment.id, reference.pspReference);
  } catch (error) {
    log.error("[PAYMENT_INTENT] Refund saved, Order comment sync failed", {
      paymentId: payment.id, refundTid, error,
    });
  }
  return true;
}

export async function executePaymentIntent(
  ctPaymentService: CommercetoolsPaymentService,
  paymentId: string,
  data: PaymentIntentRequestSchemaDTO,
): Promise<PaymentIntentResponseSchemaDTO> {
  requireValue(data.actions.length === 1, "Exactly one action required.");
  const action = data.actions[0];
  const kind = kindOf(action);
  const raw = await ctPaymentService.getPayment({ id: paymentId });
  const payment = ((raw as any).body ?? raw) as Payment;
  validate(payment, action);
  const reference = await findReference(payment, kind);
  const endpoint = kind === "capture" ? "/transaction/capture" :
    kind === "cancel" ? "/transaction/cancel" : "/transaction/refund";
  const transaction: { tid: string; amount?: number } = { tid: reference.tid };
  if (action.action === "refundPayment") transaction.amount = action.amount.centAmount;
  const reply = await callNovalnet(endpoint, transaction);
  if (kind !== "refund" && reply.transaction?.tid &&
      String(reply.transaction.tid) !== reference.tid) {
    throw new Error("Novalnet response TID does not match the original transaction.");
  }
  const outcome = getOutcome(kind, reply);
  log.info("[PAYMENT_INTENT] Novalnet modification result", {
    paymentId, kind, tid: reference.tid, outcome,
    apiStatus: reply.result?.status, transactionStatus: reply.transaction?.status,
  });
  if (outcome !== PaymentModificationStatus.APPROVED) {
    // Unknown or pending PSP results must never be recorded as successful CT
    // transactions. A definitive failure is rejected; pending awaits reconciliation.
    return { outcome, paymentReference: payment.id };
  }
  if (kind === "refund") {
    requireValue(action.action === "refundPayment", "Invalid refund action.");
    if (!await saveRefund(payment, reference, reply, action.amount.centAmount)) {
      return { outcome: PaymentModificationStatus.RECEIVED, paymentReference: payment.id };
    }
  } else {
    await saveCaptureOrCancel(payment, reference, kind, reply);
  }
  return { outcome: PaymentModificationStatus.APPROVED, paymentReference: payment.id };
}
