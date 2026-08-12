"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentRoutes = void 0;
const mock_payment_dto_1 = require("../dtos/mock-payment.dto");
const logger_1 = require("../libs/logger");
const config_1 = require("../config/config");
console.log("before-payment-routes");
logger_1.log.info("before-payment-routes");
const paymentRoutes = async (fastify, opts) => {
    fastify.post("/test", async (request, reply) => {
        console.log("Received payment request in processor");
        // Call Novalnet API server-side (no CORS issue)
        const novalnetPayload = {
            merchant: {
                signature: String((0, config_1.getConfig)()?.novalnetPrivateKey ?? ""),
                tariff: String((0, config_1.getConfig)()?.novalnetTariff ?? ""),
            },
            customer: {
                billing: {
                    city: "test",
                    country_code: "DE",
                    house_no: "test",
                    street: "test",
                    zip: "68662",
                },
                first_name: "Max",
                last_name: "Mustermann",
                email: "abiraj_s@novalnetsolutions.com",
            },
            transaction: {
                test_mode: "1",
                payment_type: "PREPAYMENT",
                amount: 10,
                currency: "EUR",
            },
            custom: {
                input1: "request",
                inputval1: String(request ?? "empty"),
                input2: "reply",
                inputval2: String(reply ?? "empty"),
            },
        };
        const novalnetResponse = await fetch("https://payport.novalnet.de/v2/payment", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-NN-Access-Key": String((0, config_1.getConfig)()?.novalnetPrivateKey ?? ""),
            },
            body: JSON.stringify(novalnetPayload),
        });
        console.log("handle-novalnetResponse");
        console.log(novalnetResponse);
    });
    fastify.post("/payments", {
        preHandler: [opts.sessionHeaderAuthHook.authenticate()],
        schema: {
            body: mock_payment_dto_1.PaymentRequestSchema,
            response: {
                200: mock_payment_dto_1.PaymentResponseSchema,
            },
        },
    }, async (request, reply) => {
        logger_1.log.info("=== PAYMENT ROUTE /payments CALLED ===");
        logger_1.log.info("Request body:", JSON.stringify(request.body, null, 2));
        logger_1.log.info("Request headers:", request.headers);
        try {
            const resp = await opts.paymentService.createPayments({
                data: request.body,
            });
            logger_1.log.info("Payment service response:", JSON.stringify(resp, null, 2));
            return reply.status(200).send(resp);
        }
        catch (error) {
            logger_1.log.error("Payment route error:", error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.log.error("Error details:", {
                message: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                name: error instanceof Error ? error.name : undefined
            });
            return reply.status(500).send({ paymentReference: 'error' });
        }
    });
    fastify.post("/payment", {
        preHandler: [opts.sessionHeaderAuthHook.authenticate()],
        schema: {
            body: mock_payment_dto_1.PaymentRequestSchema,
            response: {
                200: mock_payment_dto_1.PaymentResponseSchema,
            },
        },
    }, async (request, reply) => {
        const resp = await opts.paymentService.createPayment({
            data: request.body,
        });
        return reply.status(200).send(resp);
    });
    // Webhook endpoint for Novalnet payment notifications
    fastify.post("/novalnet-webhook", async (request, reply) => {
        const body = request.body;
        logger_1.log.info("Novalnet webhook received:", body);
        try {
            // Verify webhook signature if needed
            const paymentReference = body?.custom?.input1 || body?.custom?.inputval1;
            if (paymentReference && body?.transaction?.tid) {
                await opts.paymentService.createPaymentt({
                    data: {
                        interfaceId: body.transaction.tid,
                        status: body.transaction.status,
                        paymentReference: paymentReference,
                    },
                });
            }
            return reply.send({ message: "OK" });
        }
        catch (error) {
            logger_1.log.error("Webhook processing error:", error);
            return reply.code(400).send({ error: "Webhook processing failed" });
        }
    });
    fastify.get("/failure", async (request, reply) => {
        const query = request.query;
        const failurePageHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Failed</title>
        <script>
          window.onload = function() {
            if (window.opener) {
              window.opener.postMessage(JSON.stringify({
                nnpf_postMsg: 'payment_cancel',
                status_code: '${query.status || "FAILURE"}',
                paymentReference: '${query.paymentReference}',
                commercetoolsPaymentId: '${query.paymentReference}'
                tid: '${query.tid || ""}'
              }), '*');
              window.close();
            } else {
              setTimeout(() => {
                window.location.href = '/payment-complete?success=false&paymentReference=${query.paymentReference || query.tid || ""}';
              }, 2000);
            }
          };
        </script>
      </head>
      <body>
        <h1>Payment Failed</h1>
        <p>Your payment could not be processed.</p>
        <p>Redirecting...</p>
      </body>
      </html>
    `;
        return reply.type("text/html").send(failurePageHtml);
    });
    fastify.get("/payment-complete", async (request, reply) => {
        const query = request.query;
        const isSuccess = query.success === "true";
        const paymentRef = query.paymentReference || "";
        const completePage = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment ${isSuccess ? "Complete" : "Failed"}</title>
      </head>
      <body>
        <h1>Payment ${isSuccess ? "Successful" : "Failed"}</h1>
        ${isSuccess
            ? `<p>Payment Reference: ${paymentRef}</p><p>Thank you for your purchase!</p>`
            : "<p>Payment was not successful. Please try again.</p>"}
      </body>
      </html>
    `;
        return reply.type("text/html").send(completePage);
    });
    fastify.get("/callback", async (request, reply) => {
        return reply.send("sucess");
    });
    fastify.post("/webhook", async (request, reply) => {
        return reply.send("sucess");
    });
    fastify.get("/payments", {
        preHandler: [opts.sessionHeaderAuthHook.authenticate()],
        schema: {
            querystring: mock_payment_dto_1.PaymentRequestSchema,
            response: {
                200: mock_payment_dto_1.PaymentResponseSchema,
            },
        },
    }, async (request, reply) => {
        const resp = await opts.paymentService.createPayment({
            data: request.query,
        });
        const thirdPartyUrl = "https://poc-novalnetpayments.frontend.site/en/thank-you/?orderId=c52dc5f2-f1ad-4e9c-9dc7-e60bf80d4a52";
        // return reply.redirect(302, thirdPartyUrl);
        return reply.code(302).redirect(thirdPartyUrl);
        // return reply.status(200).send(resp);
    });
};
exports.paymentRoutes = paymentRoutes;
