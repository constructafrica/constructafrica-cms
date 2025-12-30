import { Resend } from "resend";
export default ({ action }, { services, env }) => {
  const resend = new Resend(env.EMAIL_SMTP_PASSWORD);
  const { ItemsService, UsersService } = services;

  action(
      "news_updates.items.create",
      async ({ payload, key }, { schema, accountability }) => {
        try {
          console.log("[NEWS_UPDATE_HOOK] ===== START =====");
          console.log("[NEWS_UPDATE_HOOK] Created item key:", key);
          console.log("[NEWS_UPDATE_HOOK] Payload:", JSON.stringify(payload, null, 2));

          // Only notify on published
          if (payload.status !== "published") {
            console.log("[NEWS_UPDATE_HOOK] Skipping - Status is not published:", payload.status);
            return;
          }
          console.log("[NEWS_UPDATE_HOOK] Status confirmed: published");

          /**
           * Resolve entity
           */
          let entityType = null;
          let entityId = null;

          if (payload.project) {
            entityType = "projects";
            entityId = payload.project;
            console.log("[NEWS_UPDATE_HOOK] Entity resolved - Type: projects, ID:", entityId);
          } else if (payload.company) {
            entityType = "companies";
            entityId = payload.company;
            console.log("[NEWS_UPDATE_HOOK] Entity resolved - Type: companies, ID:", entityId);
          }

          if (!entityType || !entityId) {
            console.log("[NEWS_UPDATE_HOOK] No entity found in payload");
            console.log("[NEWS_UPDATE_HOOK] payload.project:", payload.project);
            console.log("[NEWS_UPDATE_HOOK] payload.company:", payload.company);
            return;
          }

          /**
           * Services
           */
          console.log("[NEWS_UPDATE_HOOK] Initializing services...");
          const entityService = new ItemsService(entityType, {
            schema,
            accountability,
          });

          const newslettersService = new ItemsService("user_newsletters", {
            schema,
            accountability,
          });

          const notificationsService = new ItemsService("notifications", {
            schema,
            accountability,
          });

          const usersService = new UsersService({
            schema,
            accountability,
          });
          console.log("[NEWS_UPDATE_HOOK] Services initialized");

          // Update entity timestamp
          console.log("[NEWS_UPDATE_HOOK] Updating entity news_update_at timestamp...");
          await entityService.updateOne(entityId, {
            news_update_at: new Date().toISOString()
          });
          console.log("[NEWS_UPDATE_HOOK] Entity timestamp updated");

          const fieldName = entityType === 'companies' ? 'name' : 'title';

          /**
           * Fetch entity (project / company)
           */
          console.log(`[NEWS_UPDATE_HOOK] Fetching ${entityType} entity...`);
          const entity = await entityService.readOne(entityId, {
            fields: ["id", fieldName],
          });
          console.log("[NEWS_UPDATE_HOOK] Entity fetched:", JSON.stringify(entity, null, 2));

          const entityTitle = entityType === 'companies' ? entity.name : entity.title;
          console.log("[NEWS_UPDATE_HOOK] Entity title:", entityTitle);

          /**
           * Get subscribed users
           */
          console.log("[NEWS_UPDATE_HOOK] Fetching subscriptions...");
          const subscriptions = await newslettersService.readByQuery({
            filter: {
              entity_type: { _eq: entityType },
              entity_id: { _eq: entityId },
            },
            fields: ["user_created"],
            limit: -1,
          });
          console.log("[NEWS_UPDATE_HOOK] Subscriptions found:", subscriptions.length);
          console.log("[NEWS_UPDATE_HOOK] Subscription details:", JSON.stringify(subscriptions, null, 2));

          if (!subscriptions.length) {
            console.log("[NEWS_UPDATE_HOOK] No subscriptions - exiting");
            return;
          }

          /**
           * Notify users
           */
          console.log("[NEWS_UPDATE_HOOK] Starting user notification loop...");
          let notificationCount = 0;
          let emailCount = 0;
          let errorCount = 0;

          for (const sub of subscriptions) {
            const userId = sub.user_created;

            if (!userId) {
              console.log("[NEWS_UPDATE_HOOK] Skipping subscription - no user_created");
              continue;
            }

            console.log(`[NEWS_UPDATE_HOOK] Processing notification for user: ${userId}`);

            try {
              // Fetch user
              console.log(`[NEWS_UPDATE_HOOK] Fetching user ${userId}...`);
              const user = await usersService.readOne(userId, {
                fields: ["email", "first_name"],
              });
              console.log(`[NEWS_UPDATE_HOOK] User fetched - Email: ${user.email}, Name: ${user.first_name}`);

              /** In-app notification */
              console.log(`[NEWS_UPDATE_HOOK] Creating in-app notification for user ${userId}...`);
              await notificationsService.createOne({
                user: userId,
                title: `${entityType === "projects" ? "Project" : "Company"} Update`,
                message: `A new update was posted on ${entityTitle}`,
                collection: entityType,
                item: entityId,
                is_read: false,
              });
              notificationCount++;
              console.log(`[NEWS_UPDATE_HOOK] In-app notification created for user ${userId}`);

              /** Email */
              console.log(`[NEWS_UPDATE_HOOK] Sending email to ${user.email}...`);
              const emailResult = await resend.emails.send({
                from: env.EMAIL_FROM,
                to: user.email,
                subject: `New update on ${entityTitle}`,
                html: `
                <p>Hi ${user.first_name || "there"},</p>
                <p>
                  A new update has been published on
                  <strong>${entityTitle}</strong>.
                </p>
                <p>
                  <a href="${env.FRONTEND_URL}/admin/${entityType}/${entityId}">
                    View Update
                  </a>
                </p>
                <p style="font-size:12px;color:#6b7280;">
                  You are receiving this because you subscribed to notifications.
                </p>
              `,
              });
              emailCount++;
              console.log(`[NEWS_UPDATE_HOOK] Email sent successfully to ${user.email}`);
              console.log(`[NEWS_UPDATE_HOOK] Email result:`, JSON.stringify(emailResult, null, 2));
            } catch (userError) {
              errorCount++;
              console.error(`[NEWS_UPDATE_HOOK] Error processing user ${userId}:`, userError);
              console.error(`[NEWS_UPDATE_HOOK] Error stack:`, userError.stack);
            }
          }

          console.log("[NEWS_UPDATE_HOOK] ===== SUMMARY =====");
          console.log(`[NEWS_UPDATE_HOOK] Total subscriptions: ${subscriptions.length}`);
          console.log(`[NEWS_UPDATE_HOOK] Notifications created: ${notificationCount}`);
          console.log(`[NEWS_UPDATE_HOOK] Emails sent: ${emailCount}`);
          console.log(`[NEWS_UPDATE_HOOK] Errors encountered: ${errorCount}`);
          console.log("[NEWS_UPDATE_HOOK] ===== END =====");
        } catch (error) {
          console.error("[NEWS_UPDATE_HOOK] ===== FATAL ERROR =====");
          console.error("[NEWS_UPDATE_HOOK] Error:", error);
          console.error("[NEWS_UPDATE_HOOK] Error message:", error.message);
          console.error("[NEWS_UPDATE_HOOK] Error stack:", error.stack);
          console.error("[NEWS_UPDATE_HOOK] Payload at error:", JSON.stringify(payload, null, 2));
        }
      },
  );
};