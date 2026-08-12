"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentRequestSchema = exports.PaymentOutcomeSchema = exports.PaymentResponseSchema = exports.PaymentMethodType = exports.PaymentOutcome = void 0;
const typebox_1 = require("@sinclair/typebox");
var PaymentOutcome;
(function (PaymentOutcome) {
    PaymentOutcome["AUTHORIZED"] = "Authorized";
    PaymentOutcome["REJECTED"] = "Rejected";
})(PaymentOutcome || (exports.PaymentOutcome = PaymentOutcome = {}));
var PaymentMethodType;
(function (PaymentMethodType) {
    PaymentMethodType["CARD"] = "card";
    PaymentMethodType["INVOICE"] = "invoice";
    PaymentMethodType["PREPAYMENT"] = "prepayment";
    PaymentMethodType["IDEAL"] = "ideal";
    PaymentMethodType["SEPA"] = "sepa";
    PaymentMethodType["CREDITCARD"] = "creditcard";
})(PaymentMethodType || (exports.PaymentMethodType = PaymentMethodType = {}));
exports.PaymentResponseSchema = typebox_1.Type.Object({
    paymentReference: typebox_1.Type.String(),
    txnSecret: typebox_1.Type.Optional(typebox_1.Type.String()),
    redirectUrl: typebox_1.Type.Optional(typebox_1.Type.String()),
});
console.log("mock-payment-dto.ts");
exports.PaymentOutcomeSchema = typebox_1.Type.Enum(PaymentOutcome);
exports.PaymentRequestSchema = typebox_1.Type.Object({
    paymentMethod: typebox_1.Type.Object({
        type: typebox_1.Type.String(),
        poNumber: typebox_1.Type.Optional(typebox_1.Type.String()),
        invoiceMemo: typebox_1.Type.Optional(typebox_1.Type.String()),
        panHash: typebox_1.Type.Optional(typebox_1.Type.String()),
        uniqueId: typebox_1.Type.Optional(typebox_1.Type.String()),
        doRedirect: typebox_1.Type.Optional(typebox_1.Type.String()),
        returnUrl: typebox_1.Type.Optional(typebox_1.Type.String()),
    }),
    paymentOutcome: exports.PaymentOutcomeSchema,
});
