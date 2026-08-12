"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentSDK = exports.appLogger = exports.AppLogger = void 0;
const connect_payments_sdk_1 = require("@commercetools/connect-payments-sdk");
const config_1 = require("./config/config");
const context_1 = require("./libs/fastify/context/context");
const index_1 = require("./libs/logger/index");
console.log("payment-sdk.ts");
class AppLogger {
    debug = (obj, message) => {
        index_1.log.debug(message, obj || undefined);
    };
    info = (obj, message) => {
        index_1.log.info(message, obj || undefined);
    };
    warn = (obj, message) => {
        index_1.log.warn(message, obj || undefined);
    };
    error = (obj, message) => {
        index_1.log.error(message, obj || undefined);
    };
}
exports.AppLogger = AppLogger;
exports.appLogger = new AppLogger();
console.log("paymentSDKfileCalled");
exports.paymentSDK = (0, connect_payments_sdk_1.setupPaymentSDK)({
    apiUrl: config_1.config.apiUrl,
    authUrl: config_1.config.authUrl,
    clientId: config_1.config.clientId,
    clientSecret: config_1.config.clientSecret,
    projectKey: config_1.config.projectKey,
    sessionUrl: config_1.config.sessionUrl,
    jwksUrl: config_1.config.jwksUrl,
    jwtIssuer: config_1.config.jwtIssuer,
    getContextFn: () => {
        const { correlationId, requestId, authentication } = (0, context_1.getRequestContext)();
        return {
            correlationId: correlationId || "",
            requestId: requestId || "",
            authentication,
        };
    },
    updateContextFn: (context) => {
        const requestContext = Object.assign({}, context.correlationId ? { correlationId: context.correlationId } : {}, context.requestId ? { requestId: context.requestId } : {}, context.authentication ? { authentication: context.authentication } : {});
        (0, context_1.updateRequestContext)(requestContext);
    },
    logger: exports.appLogger,
});
