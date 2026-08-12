"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockPaymentService = void 0;
const connect_payments_sdk_1 = require("@commercetools/connect-payments-sdk");
const payment_intents_dto_1 = require("../dtos/operations/payment-intents.dto");
const package_json_1 = __importDefault(require("../../package.json"));
const abstract_payment_service_1 = require("./abstract-payment.service");
const config_1 = require("../config/config");
const payment_sdk_1 = require("../payment-sdk");
const mock_payment_dto_1 = require("../dtos/mock-payment.dto");
const context_1 = require("../libs/fastify/context/context");
const crypto_1 = require("crypto");
const logger_1 = require("../libs/logger");
const Context = __importStar(require("../libs/fastify/context/context"));
function getNovalnetConfigValues(type, config) {
    const upperType = type.toUpperCase();
    return {
        testMode: String(config?.[`novalnet_${upperType}_TestMode`] ?? "0"),
        paymentAction: String(config?.[`novalnet_${upperType}_PaymentAction`] ?? "payment"),
        dueDate: String(config?.[`novalnet_${upperType}_DueDate`] ?? "3"),
    };
}
function getPaymentDueDate(configuredDueDate) {
    const days = Number(configuredDueDate);
    if (isNaN(days)) {
        return null;
    }
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);
    const formattedDate = dueDate.toISOString().split("T")[0];
    return formattedDate;
}
class MockPaymentService extends abstract_payment_service_1.AbstractPaymentService {
    constructor(opts) {
        super(opts.ctCartService, opts.ctPaymentService);
    }
    async config() {
        const config = (0, config_1.getConfig)();
        return {
            clientKey: config.mockClientKey,
            environment: config.mockEnvironment,
        };
    }
    async status() {
        const handler = await (0, connect_payments_sdk_1.statusHandler)({
            timeout: (0, config_1.getConfig)().healthCheckTimeout,
            log: payment_sdk_1.appLogger,
            checks: [
                (0, connect_payments_sdk_1.healthCheckCommercetoolsPermissions)({
                    requiredPermissions: [
                        "manage_payments",
                        "view_sessions",
                        "view_api_clients",
                        "manage_orders",
                        "introspect_oauth_tokens",
                        "manage_checkout_payment_intents",
                        "manage_types",
                    ],
                    ctAuthorizationService: payment_sdk_1.paymentSDK.ctAuthorizationService,
                    projectKey: (0, config_1.getConfig)().projectKey,
                }),
                async () => {
                    try {
                        const paymentMethods = "card";
                        return {
                            name: "Mock Payment API",
                            status: "UP",
                            message: "Mock api is working",
                            details: {
                                paymentMethods,
                            },
                        };
                    }
                    catch (e) {
                        return {
                            name: "Mock Payment API",
                            status: "DOWN",
                            message: "The mock payment API is down for some reason. Please check the logs for more details.",
                            details: {
                                error: e,
                            },
                        };
                    }
                },
            ],
            metadataFn: async () => ({
                name: package_json_1.default.name,
                description: package_json_1.default.description,
                "@commercetools/connect-payments-sdk": package_json_1.default.dependencies["@commercetools/connect-payments-sdk"],
            }),
        })();
        return handler.body;
    }
    async getSupportedPaymentComponents() {
        return {
            dropins: [],
            components: [
                { type: mock_payment_dto_1.PaymentMethodType.CARD },
                { type: mock_payment_dto_1.PaymentMethodType.INVOICE },
                { type: mock_payment_dto_1.PaymentMethodType.PREPAYMENT },
                { type: mock_payment_dto_1.PaymentMethodType.IDEAL },
                { type: mock_payment_dto_1.PaymentMethodType.SEPA },
                { type: mock_payment_dto_1.PaymentMethodType.CREDITCARD },
            ],
        };
    }
    async capturePayment(request) {
        await this.ctPaymentService.updatePayment({
            id: request.payment.id,
            transaction: {
                type: "Charge",
                amount: request.amount,
                interactionId: request.payment.interfaceId,
                state: "Success",
            },
        });
        return {
            outcome: payment_intents_dto_1.PaymentModificationStatus.APPROVED,
            pspReference: request.payment.interfaceId,
        };
    }
    async cancelPayment(request) {
        await this.ctPaymentService.updatePayment({
            id: request.payment.id,
            transaction: {
                type: "CancelAuthorization",
                amount: request.payment.amountPlanned,
                interactionId: request.payment.interfaceId,
                state: "Success",
            },
        });
        return {
            outcome: payment_intents_dto_1.PaymentModificationStatus.APPROVED,
            pspReference: request.payment.interfaceId,
        };
    }
    async refundPayment(request) {
        await this.ctPaymentService.updatePayment({
            id: request.payment.id,
            transaction: {
                type: "Refund",
                amount: request.amount,
                interactionId: request.payment.interfaceId,
                state: "Success",
            },
        });
        return {
            outcome: payment_intents_dto_1.PaymentModificationStatus.APPROVED,
            pspReference: request.payment.interfaceId,
        };
    }
    async reversePayment(request) {
        const hasCharge = this.ctPaymentService.hasTransactionInState({
            payment: request.payment,
            transactionType: "Charge",
            states: ["Success"],
        });
        const hasRefund = this.ctPaymentService.hasTransactionInState({
            payment: request.payment,
            transactionType: "Refund",
            states: ["Success", "Pending"],
        });
        const hasCancelAuthorization = this.ctPaymentService.hasTransactionInState({
            payment: request.payment,
            transactionType: "CancelAuthorization",
            states: ["Success", "Pending"],
        });
        const wasPaymentReverted = hasRefund || hasCancelAuthorization;
        if (hasCharge && !wasPaymentReverted) {
            return this.refundPayment({
                payment: request.payment,
                merchantReference: request.merchantReference,
                amount: request.payment.amountPlanned,
            });
        }
        const hasAuthorization = this.ctPaymentService.hasTransactionInState({
            payment: request.payment,
            transactionType: "Authorization",
            states: ["Success"],
        });
        if (hasAuthorization && !wasPaymentReverted) {
            return this.cancelPayment({ payment: request.payment });
        }
        throw new connect_payments_sdk_1.ErrorInvalidOperation("There is no successful payment transaction to reverse.");
    }
    async ctcc(cart) {
        const deliveryAddress = payment_sdk_1.paymentSDK.ctCartService.getOneShippingAddress({
            cart,
        });
        return deliveryAddress;
    }
    async ctbb(cart) {
        const billingAddress = cart.billingAddress;
        return billingAddress;
    }
    async createPaymentt({ data }) {
        const parsedData = typeof data === "string" ? JSON.parse(data) : data;
        const config = (0, config_1.getConfig)();
        const merchantReturnUrl = (0, context_1.getMerchantReturnUrlFromContext)() || config.merchantReturnUrl;
        const novalnetPayload = {
            transaction: {
                tid: parsedData?.interfaceId ?? "",
            },
        };
        let responseData;
        try {
            const novalnetResponse = await fetch("https://payport.novalnet.de/v2/transaction/details", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-NN-Access-Key': 'YTg3ZmY2NzlhMmYzZTcxZDkxODFhNjdiNzU0MjEyMmM=',
                },
                body: JSON.stringify(novalnetPayload),
            });
            if (!novalnetResponse.ok) {
                throw new Error(`Novalnet API error: ${novalnetResponse.status}`);
            }
            responseData = await novalnetResponse.json();
        }
        catch (error) {
            logger_1.log.error("Failed to fetch transaction details from Novalnet:", error);
            throw new Error("Payment verification failed");
        }
        const paymentRef = responseData?.custom?.paymentRef ?? "";
        const ctPayment = await this.ctPaymentService.getPayment({
            id: paymentRef,
        });
        const novalnetTid = responseData?.transaction?.tid || parsedData?.interfaceId;
        let paymentDetails = `Novalnet Transaction ID: ${novalnetTid}\nPayment Status: ${responseData?.transaction?.status_text || "Completed"}`;
        if (responseData?.transaction?.bank_details) {
            const bankInfo = responseData.transaction.bank_details;
            paymentDetails += `\n\nBank Transfer Details:\nAccount holder: ${bankInfo.account_holder}\nIBAN: ${bankInfo.iban}\nBIC: ${bankInfo.bic}\nBank: ${bankInfo.bank_name}\nBank Place: ${bankInfo.bank_place}\nPayment Reference: ${novalnetTid}`;
        }
        const interactionFields = {
            novalnetTid: novalnetTid,
            paymentStatus: responseData?.transaction?.status_text || "Completed",
            transactionAmount: responseData?.transaction?.amount?.toString() || "",
            currency: responseData?.transaction?.currency || ""
        };
        if (responseData?.transaction?.bank_details) {
            const bankInfo = responseData.transaction.bank_details;
            interactionFields.bankAccountHolder = bankInfo.account_holder || "";
            interactionFields.bankIban = bankInfo.iban || "";
            interactionFields.bankBic = bankInfo.bic || "";
            interactionFields.bankName = bankInfo.bank_name || "";
            interactionFields.bankPlace = bankInfo.bank_place || "";
            interactionFields.paymentReference = novalnetTid;
        }
        let paymentDetailsText = `Novalnet TID: ${novalnetTid} | Status: ${responseData?.transaction?.status_text || "Completed"}`;
        if (responseData?.transaction?.bank_details) {
            const bankInfo = responseData.transaction.bank_details;
            paymentDetailsText += ` | Bank: ${bankInfo.account_holder} - ${bankInfo.iban} (${bankInfo.bic}) - ${bankInfo.bank_name}, ${bankInfo.bank_place}`;
        }
        const updatedPayment = await this.ctPaymentService.updatePayment({
            id: ctPayment.id,
            pspReference: novalnetTid,
            paymentMethod: `novalnet-${responseData?.transaction?.payment_type?.toLowerCase() || 'ideal'}`,
            transaction: {
                type: "Authorization",
                amount: ctPayment.amountPlanned,
                interactionId: novalnetTid,
                state: "Success"
            },
        });
        const finalPayment = updatedPayment;
        logger_1.log.info("Payment updated with Novalnet details:", {
            paymentId: finalPayment.id,
            interactionFields,
            novalnetResponse: responseData
        });
        const redirectUrl = new URL(merchantReturnUrl);
        redirectUrl.searchParams.append("paymentReference", finalPayment.id);
        return {
            paymentReference: finalPayment.id,
        };
    }
    async createPayment(request) {
        const type = String(request.data?.paymentMethod?.type ?? "INVOICE");
        const config = (0, config_1.getConfig)();
        const { testMode, paymentAction, dueDate } = getNovalnetConfigValues(type, config);
        const ctCart = await this.ctCartService.getCart({
            id: (0, context_1.getCartIdFromContext)(),
        });
        const deliveryAddress = await this.ctcc(ctCart);
        const billingAddress = await this.ctbb(ctCart);
        const parsedCart = typeof ctCart === "string" ? JSON.parse(ctCart) : ctCart;
        const dueDateValue = getPaymentDueDate(dueDate);
        const transaction = {
            test_mode: testMode === "1" ? "1" : "0",
            payment_type: String(request.data.paymentMethod.type),
            amount: String(parsedCart?.taxedPrice?.totalGross?.centAmount ?? "0"),
            currency: String(parsedCart?.taxedPrice?.totalGross?.currencyCode ?? "EUR"),
        };
        if (dueDateValue) {
            transaction.due_date = dueDateValue;
        }
        if (String(request.data.paymentMethod.type).toUpperCase() ===
            "DIRECT_DEBIT_SEPA") {
            transaction.create_token = 1;
            transaction.payment_data = {
                account_holder: String(request.data.paymentMethod.poNumber ?? "Norbert Maier"),
                iban: String(request.data.paymentMethod.invoiceMemo ?? "DE24300209002411761956"),
            };
        }
        if (String(request.data.paymentMethod.type).toUpperCase() === "CREDITCARD") {
            transaction.payment_data = {
                pan_hash: String(request.data.paymentMethod.panHash ?? ""),
                unique_id: String(request.data.paymentMethod.uniqueId ?? ""),
            };
        }
        const novalnetPayload = {
            merchant: {
                signature: String((0, config_1.getConfig)()?.novalnetPrivateKey ?? ""),
                tariff: String((0, config_1.getConfig)()?.novalnetTariff ?? ""),
            },
            customer: {
                billing: {
                    city: String(billingAddress?.city ?? "demo"),
                    country_code: String(billingAddress?.country ?? "US"),
                    house_no: String(billingAddress?.streetName ?? "10"),
                    street: String(billingAddress?.streetName ?? "teststreet"),
                    zip: String(billingAddress?.postalCode ?? "12345"),
                },
                shipping: {
                    city: String(deliveryAddress?.city ?? "demoshipping"),
                    country_code: String(deliveryAddress?.country ?? "US"),
                    house_no: String(deliveryAddress?.streetName ?? "11"),
                    street: String(deliveryAddress?.streetName ?? "testshippingstreet"),
                    zip: String(deliveryAddress?.postalCode ?? "12345"),
                },
                first_name: "Max",
                last_name: "Mustermann",
                email: "abiraj_s@novalnetsolutions.com",
            },
            transaction,
            custom: {
                input1: "currencyCode",
                inputval1: String(parsedCart?.taxedPrice?.totalGross?.currencyCode ?? "empty"),
                input2: "transaction amount",
                inputval2: String(parsedCart?.taxedPrice?.totalGross?.centAmount ?? "empty"),
                input3: "customerEmail",
                inputval3: String(parsedCart.customerEmail ?? "Email not available"),
                input4: "Payment-Method",
                inputval4: String(request.data.paymentMethod.type ?? "Payment-Method not available"),
                input5: "TestMode",
                inputval5: String(testMode ?? "0"),
            },
        };
        const url = paymentAction === "payment"
            ? "https://payport.novalnet.de/v2/payment"
            : "https://payport.novalnet.de/v2/authorize";
        let responseString = "";
        let responseData;
        try {
            const novalnetResponse = await fetch(url, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-NN-Access-Key': 'YTg3ZmY2NzlhMmYzZTcxZDkxODFhNjdiNzU0MjEyMmM=',
                },
                body: JSON.stringify(novalnetPayload),
            });
            if (!novalnetResponse.ok) {
                throw new Error(`Novalnet API error: ${novalnetResponse.status}`);
            }
            responseData = await novalnetResponse.json();
            responseString = JSON.stringify(responseData);
        }
        catch (err) {
            logger_1.log.error("Failed to process payment with Novalnet:", err);
            throw new Error("Payment processing failed");
        }
        const parsedResponse = JSON.parse(responseString);
        const transactiondetails = `Novalnet Transaction ID: ${parsedResponse?.transaction?.tid ?? "N/A"}\nTest Order`;
        let bankDetails = "";
        if (parsedResponse?.transaction?.bank_details) {
            bankDetails = `Please transfer the amount of ${parsedResponse.transaction.amount} to the following account.\nAccount holder: ${parsedResponse.transaction.bank_details.account_holder}\nIBAN: ${parsedResponse.transaction.bank_details.iban}\nBIC: ${parsedResponse.transaction.bank_details.bic}\nBANK NAME: ${parsedResponse.transaction.bank_details.bank_name}\nBANK PLACE: ${parsedResponse.transaction.bank_details.bank_place}\nPlease use the following payment reference for your money transfer:\nPayment Reference 1: ${parsedResponse.transaction.tid}`;
        }
        const ctPayment = await this.ctPaymentService.createPayment({
            amountPlanned: await this.ctCartService.getPaymentAmount({
                cart: ctCart,
            }),
            paymentMethodInfo: {
                paymentInterface: (0, context_1.getPaymentInterfaceFromContext)() || "mock",
            },
            paymentStatus: {
                interfaceCode: JSON.stringify(parsedResponse),
                interfaceText: transactiondetails + "\n" + bankDetails,
            },
            ...(ctCart.customerId && {
                customer: { typeId: "customer", id: ctCart.customerId },
            }),
            ...(!ctCart.customerId &&
                ctCart.anonymousId && {
                anonymousId: ctCart.anonymousId,
            }),
        });
        await this.ctCartService.addPayment({
            resource: { id: ctCart.id, version: ctCart.version },
            paymentId: ctPayment.id,
        });
        const pspReference = (0, crypto_1.randomUUID)().toString();
        const updatedPayment = await this.ctPaymentService.updatePayment({
            id: ctPayment.id,
            pspReference,
            paymentMethod: request.data.paymentMethod.type,
            transaction: {
                type: "Authorization",
                amount: ctPayment.amountPlanned,
                interactionId: pspReference,
                state: this.convertPaymentResultCode(request.data.paymentOutcome),
            },
        });
        return {
            paymentReference: updatedPayment.id,
        };
    }
    async createPayments(request) {
        logger_1.log.info("=== IDEAL PAYMENT START ===");
        logger_1.log.info("Request data:", JSON.stringify(request.data, null, 2));
        const type = String(request.data?.paymentMethod?.type ?? "INVOICE");
        logger_1.log.info("Payment type:", type);
        const config = (0, config_1.getConfig)();
        logger_1.log.info("Config loaded:", {
            hasPrivateKey: !!config.novalnetPrivateKey,
            hasTariff: !!config.novalnetTariff,
            privateKeyLength: config.novalnetPrivateKey?.length || 0
        });
        const { testMode, paymentAction } = getNovalnetConfigValues(type, config);
        logger_1.log.info("Novalnet config:", { testMode, paymentAction });
        const cartId = (0, context_1.getCartIdFromContext)();
        logger_1.log.info("Cart ID from context:", cartId);
        const ctCart = await this.ctCartService.getCart({
            id: cartId,
        });
        logger_1.log.info("Cart retrieved:", {
            id: ctCart.id,
            version: ctCart.version,
            customerId: ctCart.customerId,
            anonymousId: ctCart.anonymousId,
            customerEmail: ctCart.customerEmail
        });
        const deliveryAddress = await this.ctcc(ctCart);
        const billingAddress = await this.ctbb(ctCart);
        logger_1.log.info("Addresses:", {
            billing: billingAddress,
            delivery: deliveryAddress
        });
        const parsedCart = typeof ctCart === "string" ? JSON.parse(ctCart) : ctCart;
        logger_1.log.info("Cart amount:", {
            centAmount: parsedCart?.taxedPrice?.totalGross?.centAmount,
            currency: parsedCart?.taxedPrice?.totalGross?.currencyCode
        });
        const processorURL = Context.getProcessorUrlFromContext();
        const sessionId = Context.getCtSessionIdFromContext();
        logger_1.log.info("Context data:", {
            processorURL,
            sessionId
        });
        const paymentAmount = await this.ctCartService.getPaymentAmount({
            cart: ctCart,
        });
        logger_1.log.info("Payment amount calculated:", paymentAmount);
        const paymentInterface = (0, context_1.getPaymentInterfaceFromContext)() || "mock";
        logger_1.log.info("Payment interface:", paymentInterface);
        const ctPayment = await this.ctPaymentService.createPayment({
            amountPlanned: paymentAmount,
            paymentMethodInfo: {
                paymentInterface,
            },
            ...(ctCart.customerId && {
                customer: { typeId: "customer", id: ctCart.customerId },
            }),
            ...(!ctCart.customerId &&
                ctCart.anonymousId && {
                anonymousId: ctCart.anonymousId,
            }),
        });
        logger_1.log.info("CT Payment created:", {
            id: ctPayment.id,
            amountPlanned: ctPayment.amountPlanned
        });
        await this.ctCartService.addPayment({
            resource: { id: ctCart.id, version: ctCart.version },
            paymentId: ctPayment.id,
        });
        const pspReference = (0, crypto_1.randomUUID)().toString();
        const updatedPayment = await this.ctPaymentService.updatePayment({
            id: ctPayment.id,
            pspReference,
            paymentMethod: request.data.paymentMethod.type,
            transaction: {
                type: "Authorization",
                amount: ctPayment.amountPlanned,
                interactionId: pspReference,
                state: this.convertPaymentResultCode(request.data.paymentOutcome),
            },
        });
        const paymentRef = updatedPayment.id;
        const paymentCartId = ctCart.id;
        // Use merchant return URL as specified in commercetools docs
        const configData = (0, config_1.getConfig)();
        const merchantReturnUrl = configData.merchantReturnUrl || configData.merchanturl;
        const returnUrl = merchantReturnUrl;
        const errorReturnUrl = merchantReturnUrl;
        const novalnetPayload = {
            merchant: {
                signature: String((0, config_1.getConfig)()?.novalnetPrivateKey ?? ""),
                tariff: String((0, config_1.getConfig)()?.novalnetTariff ?? ""),
            },
            customer: {
                billing: {
                    city: String(billingAddress?.city ?? "demo"),
                    country_code: String(billingAddress?.country ?? "US"),
                    house_no: String(billingAddress?.streetName ?? "10"),
                    street: String(billingAddress?.streetName ?? "teststreet"),
                    zip: String(billingAddress?.postalCode ?? "12345"),
                },
                shipping: {
                    city: String(deliveryAddress?.city ?? "demoshipping"),
                    country_code: String(deliveryAddress?.country ?? "US"),
                    house_no: String(deliveryAddress?.streetName ?? "11"),
                    street: String(deliveryAddress?.streetName ?? "testshippingstreet"),
                    zip: String(deliveryAddress?.postalCode ?? "12345"),
                },
                first_name: "Max",
                last_name: "Mustermann",
                email: "abiraj_s@novalnetsolutions.com",
            },
            transaction: {
                test_mode: testMode === "1" ? "1" : "0",
                payment_type: type.toUpperCase(),
                amount: String(parsedCart?.taxedPrice?.totalGross?.centAmount ?? "100"),
                currency: String(parsedCart?.taxedPrice?.totalGross?.currencyCode ?? "EUR"),
                return_url: returnUrl,
                error_return_url: errorReturnUrl,
                create_token: 1,
            },
            hosted_page: {
                display_payments: [type.toUpperCase()],
                hide_blocks: [
                    "ADDRESS_FORM",
                    "SHOP_INFO",
                    "LANGUAGE_MENU",
                    "HEADER",
                    "TARIFF",
                ],
                skip_pages: ["CONFIRMATION_PAGE", "SUCCESS_PAGE", "PAYMENT_PAGE"],
            },
            custom: {
                input1: "paymentReference",
                inputval1: String(paymentRef ?? "no paymentRef"),
                input2: "cartId",
                inputval2: String(paymentCartId ?? "no cartId"),
                input3: "currencyCode",
                inputval3: String(parsedCart?.taxedPrice?.totalGross?.currencyCode ?? "EUR"),
                input4: "customerEmail",
                inputval4: String(parsedCart.customerEmail ?? "Email not available"),
                input5: "sessionId",
                inputval5: String(sessionId ?? "no sessionId"),
            },
        };
        logger_1.log.info("Full Novalnet payload:", JSON.stringify(novalnetPayload, null, 2));
        let parsedResponse = {};
        try {
            const novalnetResponse = await fetch("https://payport.novalnet.de/v2/seamless/payment", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-NN-Access-Key': 'YTg3ZmY2NzlhMmYzZTcxZDkxODFhNjdiNzU0MjEyMmM=',
                },
                body: JSON.stringify(novalnetPayload),
            });
            logger_1.log.info("Novalnet response status:", novalnetResponse.status);
            if (!novalnetResponse.ok) {
                throw new Error(`Novalnet API error: ${novalnetResponse.status}`);
            }
            parsedResponse = await novalnetResponse.json();
            logger_1.log.info("Novalnet response parsed:", JSON.stringify(parsedResponse, null, 2));
        }
        catch (err) {
            logger_1.log.error("Failed to process payment with Novalnet:", err);
            throw new Error("Payment initialization failed");
        }
        // Check for Novalnet API errors
        if (parsedResponse?.result?.status !== 'SUCCESS') {
            logger_1.log.error("Novalnet API error - Status not SUCCESS:", {
                status: parsedResponse?.result?.status,
                statusText: parsedResponse?.result?.status_text,
                fullResponse: parsedResponse
            });
            throw new Error(parsedResponse?.result?.status_text || "Payment initialization failed");
        }
        const txnSecret = parsedResponse?.transaction?.txn_secret;
        if (!txnSecret) {
            logger_1.log.error("No txn_secret in Novalnet response:", {
                transaction: parsedResponse?.transaction,
                fullResponse: parsedResponse
            });
            throw new Error("Payment initialization failed - missing transaction secret");
        }
        logger_1.log.info("=== IDEAL PAYMENT SUCCESS ===, returning redirect URL:", parsedResponse?.result?.redirect_url);
        return {
            paymentReference: paymentRef,
            redirectUrl: parsedResponse?.result?.redirect_url,
        };
    }
    async handleTransaction(transactionDraft) {
        const TRANSACTION_AUTHORIZATION_TYPE = "Authorization";
        const TRANSACTION_STATE_SUCCESS = "Success";
        const TRANSACTION_STATE_FAILURE = "Failure";
        const maxCentAmountIfSuccess = 10000;
        const ctCart = await this.ctCartService.getCart({
            id: transactionDraft.cartId,
        });
        let amountPlanned = transactionDraft.amount;
        if (!amountPlanned) {
            amountPlanned = await this.ctCartService.getPaymentAmount({
                cart: ctCart,
            });
        }
        const isBelowSuccessStateThreshold = amountPlanned.centAmount < maxCentAmountIfSuccess;
        const newlyCreatedPayment = await this.ctPaymentService.createPayment({
            amountPlanned,
            paymentMethodInfo: {
                paymentInterface: transactionDraft.paymentInterface,
            },
        });
        await this.ctCartService.addPayment({
            resource: {
                id: ctCart.id,
                version: ctCart.version,
            },
            paymentId: newlyCreatedPayment.id,
        });
        const transactionState = isBelowSuccessStateThreshold
            ? TRANSACTION_STATE_SUCCESS
            : TRANSACTION_STATE_FAILURE;
        const pspReference = (0, crypto_1.randomUUID)().toString();
        await this.ctPaymentService.updatePayment({
            id: newlyCreatedPayment.id,
            pspReference: pspReference,
            transaction: {
                amount: amountPlanned,
                type: TRANSACTION_AUTHORIZATION_TYPE,
                state: transactionState,
                interactionId: pspReference,
            },
        });
        if (isBelowSuccessStateThreshold) {
            return {
                transactionStatus: {
                    errors: [],
                    state: "Pending",
                },
            };
        }
        else {
            return {
                transactionStatus: {
                    errors: [
                        {
                            code: "PaymentRejected",
                            message: `Payment '${newlyCreatedPayment.id}' has been rejected.`,
                        },
                    ],
                    state: "Failed",
                },
            };
        }
    }
    convertPaymentResultCode(resultCode) {
        switch (resultCode) {
            case mock_payment_dto_1.PaymentOutcome.AUTHORIZED:
                return "Success";
            case mock_payment_dto_1.PaymentOutcome.REJECTED:
                return "Failure";
            default:
                return "Initial";
        }
    }
}
exports.MockPaymentService = MockPaymentService;
