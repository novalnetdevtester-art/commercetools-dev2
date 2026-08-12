"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const payment_sdk_1 = require("../payment-sdk");
const mock_payment_service_1 = require("../services/mock-payment.service");
const paymentService = new mock_payment_service_1.MockPaymentService({
    ctCartService: payment_sdk_1.paymentSDK.ctCartService,
    ctPaymentService: payment_sdk_1.paymentSDK.ctPaymentService,
});
exports.app = {
    services: {
        paymentService,
    },
};
