import { Stripe } from "stripe";

export default (router, { services, env, logger, getSchema, database }) => {
  const { ItemsService } = services;

  router.post("/checkout", async (req, res) => {
    try {
      console.log("starting subscription");

      const stripeSecretKey = env.STRIPE_SECRET_KEY;

      if (!stripeSecretKey) {
        console.error("No Stripe secret key found. Checked:", {
          hasRegularKey: !!env.STRIPE_SECRET_KEY,
          allKeys: Object.keys(env),
        });
        return res.status(500).json({
          success: false,
          error: "Stripe not configured",
        });
      }

      // Initialize Stripe
      const stripe = new Stripe(env.STRIPE_SECRET_KEY);

      const { accountability } = req;
      const {
        plan_id,
        success_url,
        cancel_url,
        payment_type = "one_time",
      } = req.body;

      if (!accountability?.user) {
        return res.status(403).json({
          success: false,
          error: "Authentication required",
        });
      }

      if (!plan_id) {
        return res.status(400).json({
          success: false,
          error: "plan_id is required",
        });
      }

      const schema = await getSchema();
      const plansService = new ItemsService("subscription_plans", {
        schema: schema,
        accountability: req.accountability,
      });

      // Verify plan exists
      const plan = await plansService.readOne(plan_id);
      console.log("Plan details:", plan);

      if (!plan) {
        return res.status(404).json({
          success: false,
          error: "Subscription plan not found",
        });
      }

      // Get user email
      const usersService = new ItemsService("directus_users", {
        schema: schema,
        accountability: { admin: true }, // Need admin to read user data
      });

      const user = await usersService.readOne(accountability.user, {
        fields: ["email", "first_name", "last_name"],
      });

      console.log("User details:", user);

      if (!user?.email) {
        return res.status(400).json({
          success: false,
          error: "User email not found",
        });
      }

      let sessionParams = {
        customer_email: user.email,
        mode: "payment",
        success_url:
          success_url ||
          `${env.PUBLIC_URL || "http://localhost:8055"}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:
          cancel_url ||
          `${env.PUBLIC_URL || "http://localhost:8055"}/subscription/cancel`,
        metadata: {
          user_id: accountability.user,
          plan_id: plan_id,
          payment_type: payment_type,
          billing_period: plan.billing_period
        },
        payment_method_types: ["card"],
      };

      console.log("Session params:", sessionParams);

      const amount = plan.price || plan.amount || 0;
      const currency = plan.currency || "usd";

      sessionParams.line_items = [
        {
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: Math.round(amount * 100), // Convert to cents
            product_data: {
              name: plan.name || "Subscription Plan",
              // description: plan.description || ''
            },
          },
          quantity: 1,
        },
      ];

      console.log("Creating Stripe session...");

      // Create Stripe checkout session
      const session = await stripe.checkout.sessions.create(sessionParams);

      console.log("Stripe session created:", session.id);

      // Create pending transaction record
      const transactionsService = new ItemsService("transactions", {
        schema: schema,
        accountability: req.accountability,
      });

      const transaction = await transactionsService.createOne({
        user: accountability.user,
        provider_reference: session.id,
        reference: session.id,
        provider: 'stripe',
        amount: plan.amount,
        currency: (plan.currency || "usd").toLowerCase(),
        status: "pending",
        payment_type: payment_type,
        payable_id: plan_id,
        payable_type: "subscription_plans",
      });

      console.log("Transaction created:", transaction.id);

      logger.info(
        `Checkout session created: ${session.id} for user ${accountability.user}`,
      );

      return res.json({
        success: true,
        session_id: session.id,
        checkout_url: session.url,
        transaction_id: transaction.id,
      });
    } catch (error) {
      console.error("Create checkout session error:", error);
      logger.error("Create checkout session error details:", error);

      return res.status(500).json({
        success: false,
        error: "Failed to create checkout session",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  });

  // ============================================
  // 1. GET AVAILABLE SUBSCRIPTION PLANS
  // ============================================
  router.get("/plans", async (req, res) => {
    try {
      const plansService = new ItemsService("subscription_plans", {
        schema: req.schema,
        // accountability: null,
      });

      const plans = await plansService.readByQuery({
        filter: {
          status: { _eq: "published" },
          is_active: { _eq: true },
        },
        sort: ["sort", "price"],
        fields: ["*"],
      });

      return res.json({
        success: true,
        data: plans,
      });
    } catch (error) {
      console.error("Get plans error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch subscription plans",
      });
    }
  });

  router.get("/me", async (req, res) => {
    try {
      const { accountability } = req;

      if (!accountability?.user) {
        return res.status(403).json({
          success: false,
          error: "Authentication required",
        });
      }

      const subscriptionsService = new ItemsService("user_subscriptions", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const subscription = await subscriptionsService.readByQuery({
        filter: {
          user: { _eq: accountability.user },
          status: { _eq: "active" },
        },
        fields: ["*", "subscription_plan.*"],
        limit: 1,
      });

      if (subscription.length === 0) {
        return res.json({
          success: true,
          data: null,
          message: "No active subscription",
        });
      }

      // Flatten the M2M relationships
      const sub = subscription[0];
      // sub.subscribed_regions = sub.regions?.map(r => r.regions_id).filter(Boolean) || [];
      // sub.subscribed_sectors = sub.sectors?.map(s => s.types_id).filter(Boolean) || [];
      // delete sub.regions;
      // delete sub.sectors;

      return res.json({
        success: true,
        data: sub,
      });
    } catch (error) {
      console.error("Get subscription error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch subscription",
      });
    }
  });

  router.post("/cancel", async (req, res) => {
    try {
      const { accountability } = req;

      if (!accountability?.user) {
        return res.status(403).json({
          success: false,
          error: "Authentication required",
        });
      }

      const subscriptionsService = new ItemsService("user_subscriptions", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const existing = await subscriptionsService.readByQuery({
        filter: {
          user: { _eq: accountability.user },
          status: { _eq: "active" },
        },
        limit: 1,
      });

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No active subscription found",
        });
      }

      await subscriptionsService.updateOne(existing[0].id, {
        status: "cancelled",
        auto_renew: false,
      });

      // Update user's cached fields
      const usersService = new ItemsService("directus_users", {
        schema: req.schema,
        accountability: { admin: true },
      });

      await usersService.updateOne(accountability.user, {
        subscription_status: "cancelled",
      });

      return res.json({
        success: true,
        message: "Subscription cancelled successfully",
      });
    } catch (error) {
      console.error("Cancel error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to cancel subscription",
      });
    }
  });
};
