import { Resend } from 'resend';

export default ({ action }, { services, database, env, logger }) => {
    const resend = new Resend(env.EMAIL_SMTP_PASSWORD);

    action(
        'leads.items.create',
        async ({ payload, key }, { schema }) => {
            try {
                logger.info('[LEAD_HOOK] New demo booking:', key);

                const {
                    first_name,
                    last_name,
                    company,
                    email,
                    country,
                    phone,
                    job_title
                } = payload;

                /** 📧 EMAIL ADMIN */
                await resend.emails.send({
                    from: env.EMAIL_FROM,
                    to: env.ADMIN_EMAIL,
                    subject: 'New Project Demo Booked',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #111827;">New Project Demo Booking</h2>

                            <p>A new project demo has just been booked with the following details:</p>

                            <table style="width:100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 8px 0;"><strong>Name</strong></td>
                                    <td>${first_name || ''} ${last_name || ''}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0;"><strong>Company</strong></td>
                                    <td>${company || '—'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0;"><strong>Email</strong></td>
                                    <td>${email || '—'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0;"><strong>Phone</strong></td>
                                    <td>${phone || '—'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0;"><strong>Country</strong></td>
                                    <td>${country || '—'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0;"><strong>Job Title</strong></td>
                                    <td>${job_title || '—'}</td>
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
                    `
                });

                logger.info('[LEAD_HOOK] Admin notification email sent');

            } catch (error) {
                logger.error('[LEAD_HOOK] Failed to send admin notification', {
                    message: error.message,
                    stack: error.stack
                });
            }
        }
    );
};
