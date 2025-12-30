import { Resend } from "resend";
export default ({ action }, { services, env }) => {
  const resend = new Resend(env.EMAIL_SMTP_PASSWORD);
  const { ItemsService, UsersService } = services;

  action(
    "news_updates.items.create",
    async ({ payload, key }, { schema, accountability }) => {
      try {
        console.log("[NEWS_UPDATE_HOOK] Created:", key);

        // Only notify on published
        if (payload.status !== "published") return;

        /**
         * Resolve entity
         */
        let entityType = null;
        let entityId = null;

        if (payload.project) {
          entityType = "projects";
          entityId = payload.project;
        } else if (payload.company) {
          entityType = "companies";
          entityId = payload.company;
        }

        if (!entityType || !entityId) {
          console.log("[NEWS_UPDATE_HOOK] No entity found");
          return;
        }

        /**
         * Services
         */
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

        await entityService.updateOne(entityId, {
          news_update_at: new Date().toISOString()
        });

        const fieldName = entityType === 'companies' ? 'name' : 'title';

        /**
         * Fetch entity (project / company)
         */
        const entity = await entityService.readOne(entityId, {
          fields: ["id", fieldName],
        });

        const entityTitle =  entityType === 'companies' ? entity.name : entity.title;

        /**
         * Get subscribed users
         */
        const subscriptions = await newslettersService.readByQuery({
          filter: {
            entity_type: { _eq: entityType },
            entity_id: { _eq: entityId },
          },
          fields: ["user_created"],
          limit: -1,
        });

        if (!subscriptions.length) return;

        /**
         * Notify users
         */
        for (const sub of subscriptions) {
          const userId = sub.user_created;
          if (!userId) continue;


          const user = await usersService.readOne(userId, {
            fields: ["email", "first_name"],
          });

          /** In-app notification */
          await notificationsService.createOne({
            user: userId,
            title: `${entityType === "projects" ? "Project" : "Company"} Update`,
            message: `A new update was posted on ${entityTitle}`,
            collection: entityType,
            item: entityId,
            is_read: false,
          });

          /** Email */
          await resend.emails.send({
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
        }

        console.log("[NEWS_UPDATE_HOOK] Notifications sent");
      } catch (error) {
        console.error("[NEWS_UPDATE_HOOK] Error:", error);
      }
    },
  );
};
