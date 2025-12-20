const express = require('express')

module.exports = function registerHook({ init }) {
    init('middlewares.before', async function ({ app }) {
        // Use raw body parser specifically for Stripe webhook
        app.use('/ca-stripe-webho',
            express.raw({ type: 'application/json' }),
            (req, res, next) => {
                req.rawBody = req.body.toString('utf8');
                next();
            }
        );

        // JSON parser for everything else
        app.use(express.json());
    });
}