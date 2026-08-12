"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const payment_sdk_1 = require("../../payment-sdk");
const mock_payment_route_1 = require("../../routes/mock-payment.route");
const mock_payment_service_1 = require("../../services/mock-payment.service");
async function default_1(server) {
    const mockPaymentService = new mock_payment_service_1.MockPaymentService({
        ctCartService: payment_sdk_1.paymentSDK.ctCartService,
        ctPaymentService: payment_sdk_1.paymentSDK.ctPaymentService,
    });
    await server.register(mock_payment_route_1.paymentRoutes, {
        paymentService: mockPaymentService,
        sessionHeaderAuthHook: payment_sdk_1.paymentSDK.sessionHeaderAuthHookFn,
    });
}
