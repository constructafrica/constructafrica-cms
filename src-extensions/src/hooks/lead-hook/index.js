import { Resend } from "resend";
import { hashToken, generateVerificationToken } from "../../helpers/index.js";

export default ({ action }, { services, database, env, logger, getSchema }) => {
  const resend = new Resend(env.EMAIL_SMTP_PASSWORD);
  const { ItemsService, UsersService } = services;

  /* ===============================
     CREATE: New lead notification
  =============================== */
  action("leads.items.create", async ({ payload, key }, { schema }) => {
    try {
      console.log(`[CREATE LEAD] New lead created`);
      logger.info("[LEAD_HOOK] New demo booking:", key);

      const {
        first_name,
        last_name,
        company,
        email,
        country,
        phone,
        job_title,
      } = payload;

      // Validate required fields
      if (!email) {
        logger.error("[LEAD_HOOK] Missing required email field");
        return;
      }

      let countryName = "—";

      // Fetch country if provided
      if (country) {
        try {
          const countryService = new ItemsService("countries", {
            knex: database,
            schema: schema,
          });

          const countryModel = await countryService.readOne(country, {
            fields: ['id', 'name']
          });

          countryName = countryModel?.name || "—";
        } catch (error) {
          logger.warn("[LEAD_HOOK] Could not fetch country", { country, error: error.message });
        }
      }

      /** 📧 EMAIL ADMIN */
      await resend.emails.send({
        from: env.EMAIL_FROM,
        to: env.ADMIN_EMAIL,
        subject: "New Project Demo Booked",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #111827;">New Project Demo Booking</h2>

            <p>A new project demo has just been booked with the following details:</p>

            <table style="width:100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0;"><strong>Name</strong></td>
                <td>${first_name || ""} ${last_name || ""}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Company</strong></td>
                <td>${company || "—"}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Email</strong></td>
                <td>${email || "—"}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Phone</strong></td>
                <td>${phone || "—"}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Country</strong></td>
                <td>${countryName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Job Title</strong></td>
                <td>${job_title || "—"}</td>
              </tr>
            </table>

            <hr style="margin: 24px 0;" />

            <p>
              <a
                href="${env.PUBLIC_URL}/admin/leads/${key}"
                style="
                  display: inline-block;
                  padding: 12px 20px;
                  background-color: #111827;
                  color: #ffffff;
                  text-decoration: none;
                  border-radius: 6px;
                  font-weight: bold;
                "
              >
                View Lead in Admin
              </a>
            </p>

            <p style="margin-top: 24px; font-size: 12px; color: #6b7280;">
              This email was automatically sent when a demo was booked.
            </p>
          </div>
        `,
      });

      logger.info("[LEAD_HOOK] Admin notification email sent");
    } catch (error) {
      logger.error("[LEAD_HOOK] Failed to send admin notification", {
        message: error.message,
        stack: error.stack,
      });
    }
  });

  /* ===============================
     UPDATE: Convert lead → user
  =============================== */
  action("leads.items.update", async ({ payload, keys }, { schema }) => {
    // Log immediately to confirm hook is triggered
    console.log(`[LEAD_UPDATE] ========== HOOK TRIGGERED ==========`);
    console.log(`[LEAD_UPDATE] Keys:`, keys);
    console.log(`[LEAD_UPDATE] Payload keys:`, Object.keys(payload));
    console.log(`[LEAD_UPDATE] Full Payload:`, JSON.stringify(payload, null, 2));
    logger.info(`[LEAD_UPDATE] Hook triggered for keys:`, keys);

    try {
      const leadId = payload.id || keys[0];

      if (!leadId) {
        logger.error("[LEAD_UPDATE] No lead ID found in payload or keys");
        console.log(`[LEAD_UPDATE] EXITING: No lead ID`);
        return;
      }

      console.log(`[LEAD_UPDATE] Lead ID: ${leadId}`);

      // Only proceed if status field is being updated
      if (!payload.status) {
        console.log(`[LEAD_UPDATE] EXITING: No status in payload`);
        logger.info(`[LEAD_UPDATE] No status field in payload, skipping`);
        return;
      }

      console.log(`[LEAD_UPDATE] Status in payload: ${payload.status}`);

      // Initialize services
      const leadsService = new ItemsService("leads", {
        knex: database,
        schema,
      });

      const usersService = new UsersService({
        knex: database,
        schema,
      });

      const subscriptionsService = new ItemsService("user_subscriptions", {
        knex: database,
        schema,
      });

      const plansService = new ItemsService('subscription_plans', {
        knex: database,
        schema
      });

      // Fetch the lead
      let lead;
      try {
        lead = await leadsService.readOne(leadId, {
          fields: [
            "id",
            "email",
            "first_name",
            "last_name",
            "company",
            "country",
            "job_title",
            "status",
            "plan",
            "start_date",
            "end_date",
            "amount",
          ],
        });
        logger.info(`[LEAD_UPDATE] Lead fetched:`, JSON.stringify(lead));
      } catch (fetchError) {
        logger.error("[LEAD_UPDATE] Failed to fetch lead", {
          leadId,
          message: fetchError.message,
          stack: fetchError.stack,
        });
        throw fetchError;
      }

      // Only act on status transition TO "subscribed"
      if (payload.status !== "subscribed") {
        logger.info(`[LEAD_UPDATE] Skipping - status is not "subscribed": ${payload.status}`);
        console.log(`[LEAD_UPDATE] EXITING: Status is ${payload.status}, not "subscribed"`);
        return;
      }

      console.log(`[LEAD_UPDATE] Status is "subscribed", checking if already converted...`);

      // Check if this lead has already been converted by checking for existing subscription
      const existingSubscriptions = await subscriptionsService.readByQuery({
        filter: { lead_id: { _eq: leadId } },
        limit: 1,
      });

      if (existingSubscriptions.length > 0) {
        logger.info(`[LEAD_UPDATE] Lead ${leadId} already converted, skipping`);
        console.log(`[LEAD_UPDATE] EXITING: Lead already has subscription ${existingSubscriptions[0].id}`);
        return;
      }

      console.log(`[LEAD_UPDATE] Lead not yet converted, proceeding with conversion...`);

      console.log(`[LEAD_UPDATE] Converting lead ${leadId} to user`);

      // Validate required fields
      if (!lead.email || !lead.plan) {
        logger.error("[LEAD_UPDATE] Missing required fields", {
          hasEmail: !!lead.email,
          hasPlan: !!lead.plan,
          email: lead.email,
          plan: lead.plan,
        });
        throw new Error("Missing required fields: email or plan");
      }

      // Check if user already exists
      let existingUsers;
      try {
        existingUsers = await usersService.readByQuery({
          filter: { email: { _eq: lead.email } },
          limit: 1,
        });
        logger.info(`[LEAD_UPDATE] Found ${existingUsers.length} existing users with email ${lead.email}`);
      } catch (userCheckError) {
        logger.error("[LEAD_UPDATE] Failed to check for existing users", {
          email: lead.email,
          message: userCheckError.message,
        });
        throw userCheckError;
      }

      let user;

      if (existingUsers.length > 0) {
        user = existingUsers[0];
        logger.info(`[LEAD_UPDATE] User already exists: ${user.id}`);
      } else {
        // Fetch plan details
        let plan;
        try {
          plan = await plansService.readOne(lead.plan, {
            fields: ['id', 'role']
          });
          logger.info(`[LEAD_UPDATE] Plan fetched:`, JSON.stringify(plan));
        } catch (planError) {
          logger.error("[LEAD_UPDATE] Failed to fetch plan", {
            planId: lead.plan,
            message: planError.message,
          });
          throw planError;
        }

        if (!plan) {
          const error = new Error("Plan not found");
          logger.error("[LEAD_UPDATE] Plan not found", { planId: lead.plan });
          throw error;
        }

        // Generate verification token
        const verificationToken = generateVerificationToken();
        const hashedToken = hashToken(verificationToken);

        // Create user
        try {
          user = await usersService.createOne({
            email: lead.email,
            first_name: lead.first_name,
            last_name: lead.last_name,
            status: "draft",
            email_verification_token: hashedToken,
            verification_status: false,
            role: plan.role,
          });

          logger.info(`[LEAD_UPDATE] User created with ID: ${user?.id || user}`);
          console.log(`[LEAD_UPDATE] User object:`, JSON.stringify(user));

          // If user is just an ID string, fetch the full user object
          if (typeof user === 'string') {
            const userId = user;
            user = await usersService.readOne(userId);
            logger.info(`[LEAD_UPDATE] Fetched full user object for ${userId}`);
          }

          if (!user || !user.id) {
            throw new Error("User creation returned invalid object");
          }
        } catch (userCreateError) {
          logger.error("[LEAD_UPDATE] Failed to create user", {
            email: lead.email,
            message: userCreateError.message,
            stack: userCreateError.stack,
          });
          throw userCreateError;
        }

        // Send invite email
        const frontendUrl = env.FRONTEND_URL;
        const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

        try {
          const { error } = await resend.emails.send({
            from: env.EMAIL_FROM,
            to: lead.email,
            subject: "You're invited — activate your account",
            html: `
              <h2>Welcome to ConstructAfrica</h2>
              <p>Hello ${lead.first_name || ""},</p>

              <p>
                An account has been created for you following your subscription.
                Please verify your email to activate your access.
              </p>

              <p>
                <a href="${verificationUrl}" style="
                  display: inline-block;
                  padding: 12px 20px;
                  background-color: #111827;
                  color: #ffffff;
                  text-decoration: none;
                  border-radius: 6px;
                  font-weight: bold;
                ">
                  Activate your account
                </a>
              </p>

              <p>
                Or copy and paste this link into your browser:
                <br />
                ${verificationUrl}
              </p>

              <p>This link expires in 24 hours.</p>
            `,
          });

          if (error) {
            logger.error("❌ Failed to send invite email", error);
            // Rollback user creation
            await usersService.deleteOne(user.id);
            throw new Error("Invite email failed - user creation rolled back");
          }

          logger.info(`[LEAD_UPDATE] Invite sent to ${lead.email}`);
        } catch (emailError) {
          logger.error("[LEAD_UPDATE] Email sending failed", {
            message: emailError.message,
            stack: emailError.stack,
          });
          throw emailError;
        }
      }

      // Create subscription
      let subscription;
      try {
        subscription = await subscriptionsService.createOne({
          user: user.id,
          plan: lead.plan,
          status: "active",
          start_date: lead.start_date,
          end_date: lead.end_date,
          amount: lead.amount,
          lead_id: lead.id,
        });

        logger.info(`[LEAD_UPDATE] Subscription created with ID: ${subscription?.id || subscription}`);
        console.log(`[LEAD_UPDATE] Subscription object:`, JSON.stringify(subscription));

        // If subscription is just an ID string, fetch the full object
        if (typeof subscription === 'string') {
          const subscriptionId = subscription;
          subscription = await subscriptionsService.readOne(subscriptionId);
          logger.info(`[LEAD_UPDATE] Fetched full subscription object for ${subscriptionId}`);
        }

        if (!subscription || !subscription.id) {
          throw new Error("Subscription creation returned invalid object");
        }
      } catch (subscriptionError) {
        logger.error("[LEAD_UPDATE] Failed to create subscription", {
          userId: user.id,
          leadId: lead.id,
          message: subscriptionError.message,
          stack: subscriptionError.stack,
        });
        throw subscriptionError;
      }

      // Update user with subscription info
      try {
        await usersService.updateOne(user.id, {
          subscription_status: "active",
          subscription_start: lead.start_date,
          subscription_expiry: lead.end_date,
          active_subscription: subscription.id,
          subscription_plan: lead.plan,
        });

        logger.info(`[LEAD_UPDATE] User ${user.id} updated with subscription info`);
        console.log(`[LEAD_UPDATE] ========== CONVERSION SUCCESSFUL ==========`);
      } catch (updateError) {
        logger.error("[LEAD_UPDATE] Failed to update user with subscription info", {
          userId: user.id,
          subscriptionId: subscription.id,
          message: updateError.message,
          stack: updateError.stack,
        });
        throw updateError;
      }

    } catch (error) {
      logger.error("[LEAD_UPDATE] Failed to convert lead", {
        leadId: payload.id,
        message: error.message,
        stack: error.stack,
      });

      // Notify admin of failure
      try {
        let leadForEmail;
        try {
          const leadsService = new ItemsService("leads", {
            knex: database,
            schema,
          });

          leadForEmail = await leadsService.readOne(leadId, {
            fields: ["id", "email", "first_name", "last_name", "company"],
          });
        } catch (leadFetchError) {
          logger.error("[LEAD_UPDATE] Failed to fetch lead for email notification", {
            message: leadFetchError.message,
          });
          // Use basic info from error context
          leadForEmail = {
            id: leadId,
            email: "Unknown",
            first_name: "",
            last_name: "",
            company: "",
          };
        }

        await resend.emails.send({
          from: env.EMAIL_FROM,
          to: env.ADMIN_EMAIL,
          subject: "⚠️ Lead Conversion Failed",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #dc2626;">Lead Conversion Failed</h2>

              <p>An error occurred while converting a lead to a user subscription.</p>

              <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                  <td style="padding: 8px 0;"><strong>Lead ID</strong></td>
                  <td>${leadForEmail.id}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Name</strong></td>
                  <td>${leadForEmail.first_name || ""} ${leadForEmail.last_name || ""}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Email</strong></td>
                  <td>${leadForEmail.email || "—"}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Company</strong></td>
                  <td>${leadForEmail.company || "—"}</td>
                </tr>
              </table>

              <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 12px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold; color: #dc2626;">Error Message:</p>
                <p style="margin: 8px 0 0 0; font-family: monospace; font-size: 14px;">
                  ${error.message}
                </p>
              </div>

              <p>
                <a
                  href="${env.PUBLIC_URL}/admin/leads/${leadForEmail.id}"
                  style="
                    display: inline-block;
                    padding: 12px 20px;
                    background-color: #111827;
                    color: #ffffff;
                    text-decoration: none;
                    border-radius: 6px;
                    font-weight: bold;
                  "
                >
                  View Lead in Admin
                </a>
              </p>

              <p style="margin-top: 24px; font-size: 12px; color: #6b7280;">
                Please review and manually process this lead conversion.
              </p>
            </div>
          `,
        });

        logger.info("[LEAD_UPDATE] Admin failure notification sent");
      } catch (notificationError) {
        logger.error("[LEAD_UPDATE] Failed to send admin failure notification", {
          message: notificationError.message,
        });
      }
    }
  });
};