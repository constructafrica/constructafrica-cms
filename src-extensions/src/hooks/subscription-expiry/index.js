export default ({ filter, action, schedule }, { services, database, logger }) => {
    const { ItemsService } = services;

    // ============================================
    // CRON: Check and expire subscriptions daily
    // Runs every day at 2 AM
    // ============================================
    schedule('0 2 * * *', async () => {
        try {
            logger.info('Starting subscription expiry check...');

            const now = new Date();

            // Find expired subscriptions
            const expiredSubscriptions = await database('user_subscriptions')
                .where('status', 'active')
                .where('end_date', '<', now.toISOString())
                .select('id', 'user');

            logger.info(`Found ${expiredSubscriptions.length} expired subscriptions`);

            for (const subscription of expiredSubscriptions) {
                // Update subscription status
                await database('user_subscriptions')
                    .where('id', subscription.id)
                    .update({
                        status: 'expired',
                        date_updated: now.toISOString(),
                    });

                // Update user's cached subscription fields
                await database('directus_users')
                    .where('id', subscription.user)
                    .update({
                        subscription_status: 'expired',
                        subscription_type: 'none',
                    });

                logger.info(`Expired subscription ${subscription.id} for user ${subscription.user}`);
            }

            logger.info('Subscription expiry check completed');
        } catch (error) {
            logger.error('Subscription expiry check failed:', error);
        }
    });

    // ============================================
    // HOOK: Auto-update user cache when subscription changes
    // ============================================
    action('user_subscriptions.items.update', async ({ payload, key, accountability }) => {
        try {
            const subscription = await database('user_subscriptions')
                .where('id', key)
                .first('user', 'status', 'end_date', 'subscription_plan');

            if (!subscription) return;

            const plan = await database('subscription_plans')
                .where('id', subscription.subscription_plan)
                .first('type');

            // Update user's cached fields
            await database('directus_users')
                .where('id', subscription.user)
                .update({
                    active_subscription: subscription.status === 'active' ? key : null,
                    subscription_type: subscription.status === 'active' ? plan?.type : 'none',
                    subscription_status: subscription.status,
                    subscription_expires_at: subscription.end_date,
                });

            logger.info(`Updated cache for user ${subscription.user} after subscription change`);
        } catch (error) {
            logger.error('Failed to update user cache:', error);
        }
    });

    // ============================================
    // HOOK: Auto-update user cache when subscription created
    // ============================================
    action('user_subscriptions.items.create', async ({ payload, key, accountability }) => {
        try {
            const subscription = await database('user_subscriptions')
                .where('id', key)
                .first('user', 'status', 'end_date', 'subscription_plan');

            if (!subscription) return;

            const plan = await database('subscription_plans')
                .where('id', subscription.subscription_plan)
                .first('type');

            // Update user's cached fields
            await database('directus_users')
                .where('id', subscription.user)
                .update({
                    active_subscription: subscription.status === 'active' ? key : null,
                    subscription_type: subscription.status === 'active' ? plan?.type : 'none',
                    subscription_status: subscription.status,
                    subscription_expires_at: subscription.end_date,
                });

            logger.info(`Updated cache for user ${subscription.user} after subscription created`);
        } catch (error) {
            logger.error('Failed to update user cache:', error);
        }
    });

    // ============================================
    // HOOK: Send email notification before expiry
    // Runs 7 days before expiry
    // ============================================
    schedule('0 9 * * *', async () => {
        try {
            logger.info('Checking for subscriptions expiring soon...');

            const sevenDaysFromNow = new Date();
            sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

            const expiringSubscriptions = await database('user_subscriptions as us')
                .join('directus_users as u', 'us.user', 'u.id')
                .where('us.status', 'active')
                .whereBetween('us.end_date', [
                    new Date().toISOString(),
                    sevenDaysFromNow.toISOString()
                ])
                .select('us.id', 'us.end_date', 'u.email', 'u.first_name', 'u.last_name');

            logger.info(`Found ${expiringSubscriptions.length} subscriptions expiring within 7 days`);

            // TODO: Send email notifications
            // Integrate with your email service (SendGrid, Mailgun, etc.)
            for (const subscription of expiringSubscriptions) {
                logger.info(`Should send expiry reminder to ${subscription.email}`);
                // await sendEmail({
                //     to: subscription.email,
                //     subject: 'Your subscription is expiring soon',
                //     template: 'subscription-expiry-reminder',
                //     data: { subscription }
                // });
            }
        } catch (error) {
            logger.error('Expiry notification check failed:', error);
        }
    });
};