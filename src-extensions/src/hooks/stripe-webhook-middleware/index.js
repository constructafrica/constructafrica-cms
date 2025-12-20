// const express = require('express')
// module.exports = function registerHook({ init }) {
//     init('middlewares.before', async function ({ app }) {
//         app.use(
//             express.json({
//                 verify: (req, res, buf) => {
//                     // Change the path to stripe endpoint
//                     console.log('URL', req.originalUrl);
//                     if (req.originalUrl.startsWith('/ca-stripe-webho')) {
//                         req.rawBody = buf.toString()
//                     }
//                 },
//             })
//         )
//     })
// }
const express = require('express')
module.exports = function registerHook({ init }) {
    init('middlewares.before', async function ({ app }) {
        app.use(
            express.json({
                verify: (req, res, buf) => {
                    // ONLY capture raw body for Stripe webhook
                    if (req.originalUrl.startsWith('/ca-stripe-webho')) {
                        req.rawBody = buf.toString();
                    }
                },
            })
        );
    });
}