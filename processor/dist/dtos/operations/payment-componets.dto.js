"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupportedPaymentComponentsSchema = exports.SupportedPaymentComponentsData = exports.SupportedPaymentDropinsData = void 0;
const typebox_1 = require("@sinclair/typebox");
console.log("payment-componets.dto.ts");
const DropinType = typebox_1.Type.Enum({
    EMBEDDED: "embedded",
    HPP: "hpp",
});
exports.SupportedPaymentDropinsData = typebox_1.Type.Object({
    type: DropinType,
});
exports.SupportedPaymentComponentsData = typebox_1.Type.Object({
    type: typebox_1.Type.String(),
    subtypes: typebox_1.Type.Optional(typebox_1.Type.Array(typebox_1.Type.String())),
});
/**
 * Supported payment components schema.
 *
 * Example:
 * {
 *   "dropins": [
 *     {
 *       "type": "embedded"
 *     }
 *   ],
 *   "components": [
 *     {
 *       "type": "card"
 *     },
 *     {
 *       "type": "applepay"
 *     }
 *   ]
 * }
 */
exports.SupportedPaymentComponentsSchema = typebox_1.Type.Object({
    dropins: typebox_1.Type.Array(exports.SupportedPaymentDropinsData),
    components: typebox_1.Type.Array(exports.SupportedPaymentComponentsData),
});
