import { Resend } from "resend";
import {hashToken, generateVerificationToken} from "../../helpers/index.js";

export default ({ action }, { services, database, env, logger }) => {
  const resend = new Resend(env.EMAIL_SMTP_PASSWORD);

  action("leads.items.create", async ({ payload, key }, { schema }) => {
    try {
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
    try {
      const leadId = keys[0];
      if (!payload.status) return;

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

      const lead = await leadsService.readOne(leadId, {
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

      /** 2️⃣ Only act on status transition */
      if (
          lead.status === "subscribed" ||
          payload.status !== "subscribed"
      ) {
        return;
      }

      logger.info(`[LEAD_UPDATE] Converting lead ${leadId} to user`);

      /** 3️⃣ Check if user already exists */
      const existingUsers = await usersService.readByQuery({
        filter: { email: { _eq: lead.email } },
        limit: 1,
      });

      let user;

      if (existingUsers.length > 0) {
        user = existingUsers[0];
        logger.info(`[LEAD_UPDATE] User already exists: ${user.id}`);
      } else {
        const verificationToken = generateVerificationToken();
        const hashedToken = hashToken(verificationToken);

        const plan = await plansService.readOne(resolvedPlanId, {
          fields: ['id', 'role']
        });

        /** 4️⃣ Create user */
        user = await usersService.createOne({
          email: lead.email,
          first_name: lead.first_name,
          last_name: lead.last_name,
          status: "draft",
          email_verification_token: hashedToken,
          verification_status: false,
          role: plan.role,
        });

        /** Send invite email */
        const frontendUrl = env.FRONTEND_URL;
        const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

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
              <a href="${verificationUrl}">
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
          await usersService.deleteOne(user);
          throw new Error("Invite email failed");
        }

        logger.info(`[LEAD_UPDATE] Invite sent to ${lead.email}`);
      }

      /** 6️⃣ Create subscription */
      const subscription = await subscriptionsService.createOne({
        user: user.id,
        plan: lead.plan,
        status: "active",
        start_date: lead.start_date,
        end_date: lead.end_date,
        amount: lead.amount,
        source: "lead",
      });

      /** 7️⃣ Update user with subscription info */
      await usersService.updateOne(user.id, {
        subscription_status: "active",
        subscription_start: lead.start_date,
        subscription_expiry: lead.end_date,
        active_subscription: subscription.id,
        subscription_plan: lead.plan,
      });

      logger.info(
          `[LEAD_UPDATE] Subscription created for user ${user.id}`
      );
    } catch (error) {
      logger.error("[LEAD_UPDATE] Failed to convert lead", {
        message: error.message,
        stack: error.stack,
      });
    }
  });
};
