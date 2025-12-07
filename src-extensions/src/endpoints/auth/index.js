
import { createHash, randomBytes } from 'crypto';
import { Resend } from 'resend';


export default (router, { services, exceptions, env, logger }) => {
    const { UsersService, MailService } = services;
    // const { InvalidPayloadException, ForbiddenException } = exceptions;

    // Helper function to generate verification token
    function generateVerificationToken() {
        return randomBytes(32).toString('hex');
    }

    // Helper function to hash token for storage
    function hashToken(token) {
        return createHash('sha256').update(token).digest('hex');
    }

    // POST /auth/register
    router.post('/register', async (req, res) => {
        try {
            const { email, password, first_name, last_name } = req.body;

            // Validate required fields
            if (!email || !password) {
                return res.status(422).send(`Email and password are required`);
            }

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(422).send(`Invalid email format`);
            }

            // Validate password strength (min 8 characters)
            if (password.length < 8) {
                return res.status(422).send(`Password must be at least 8 characters`);
            }

            const usersService = new UsersService({ schema: req.schema });

            // Check if user already exists
            const existingUsers = await usersService.readByQuery({
                filter: { email: { _eq: email } },
                limit: 1
            });

            if (existingUsers.length > 0) {
                return res.status(422).send(`User with this email already exists`);
            }

            // Generate verification token
            const verificationToken = generateVerificationToken();
            const hashedToken = hashToken(verificationToken);

            // Get the authenticated role UUID from env
            const authenticatedRoleUuid = env.PUBLIC_REGISTRATION_ROLE;

            if (!authenticatedRoleUuid) {
                return res.status(400).send(`PUBLIC_REGISTRATION_ROLE not configured`);
            }

            // Create user with unverified status
            const user = await usersService.createOne({
                email,
                password,
                first_name: first_name || null,
                last_name: last_name || null,
                role: authenticatedRoleUuid,
                status: 'draft', // User is inactive until verified
                email_verification_token: hashedToken,
                verification_status: false
            });

            // Send verification email
            const mailService = new MailService({ schema: req.schema });
            const verificationUrl = `${env.PUBLIC_URL}/verify-email?token=${verificationToken}`;

            await mailService.send({
                to: email,
                subject: 'Verify your email address',
                html: `
					<h2>Welcome!</h2>
					<p>Thank you for registering. Please verify your email address by clicking the link below:</p>
					<p><a href="${verificationUrl}">Verify Email</a></p>
					<p>Or copy and paste this link into your browser:</p>
					<p>${verificationUrl}</p>
					<p>This link will expire in 24 hours.</p>
				`
            });


            // const resend = new Resend('re_K1N6oyvo_5sMBNiznzGoBdgehKub11JLV');
            //
            // await (async function () {
            //     const {data, error} = await resend.emails.send({
            //         from: 'onboarding@resend.dev',
            //         to: email,
            //         subject: 'Verify your email address',
            //         html: `
			// 		<h2>Welcome!</h2>
			// 		<p>Thank you for registering. Please verify your email address by clicking the link below:</p>
			// 		<p><a href="${verificationUrl}">Verify Email</a></p>
			// 		<p>Or copy and paste this link into your browser:</p>
			// 		<p>${verificationUrl}</p>
			// 		<p>This link will expire in 24 hours.</p>
			// 	`
            //     });
            //
            //     if (error) {
            //         return console.error({error});
            //     }
            //
            //     console.log({data});
            // })();

            logger.info(`Registration email sent to ${email}`);

            return res.json({
                success: true,
                message: 'Registration successful. Please check your email to verify your account.'
            });

        } catch (error) {
            logger.error('Registration error:', error);

            return res.status(500).json({
                success: false,
                message: 'Registration failed. Please try again.'
            });
        }
    });

    // POST /auth/verify-email
    router.post('/verify-email', async (req, res) => {
        try {
            const { token } = req.body;

            if (!token) {
                return res.status(422).send(`Verification token is required`);
            }

            const hashedToken = hashToken(token);
            const usersService = new UsersService({ schema: req.schema });

            // Find user with this token
            const users = await usersService.readByQuery({
                filter: {
                    email_verification_token: { _eq: hashedToken },
                    status: { _eq: 'draft' }
                },
                limit: 1
            });

            if (users.length === 0) {
                return res.status(422).send(`Invalid or expired verification token`);
            }

            const user = users[0];

            // Update user to verified status
            await usersService.updateOne(user.id, {
                status: 'active',
                verification_status: true,
                email_verification_token: null
            });

            logger.info(`Email verified for user ${user.email}`);

            return res.json({
                success: true,
                message: 'Email verified successfully. You can now log in.'
            });

        } catch (error) {
            logger.error('Verification error:', error);
            return res.status(500).json({
                success: false,
                message: 'Verification failed. Please try again.'
            });
        }
    });

    // POST /auth/resend-verification
    router.post('/resend-verification', async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(422).send(`Email is required`);
            }

            const usersService = new UsersService({ schema: req.schema });

            // Find unverified user
            const users = await usersService.readByQuery({
                filter: {
                    email: { _eq: email },
                    status: { _eq: 'draft' }
                },
                limit: 1
            });

            if (users.length === 0) {
                // Don't reveal if user exists or not
                return res.json({
                    success: true,
                    message: 'If an unverified account exists, a new verification email has been sent.'
                });
            }

            const user = users[0];

            // Generate new verification token
            const verificationToken = generateVerificationToken();
            const hashedToken = hashToken(verificationToken);

            // Update user with new token
            await usersService.updateOne(user.id, {
                email_verification_token: hashedToken
            });

            // Send verification email
            const mailService = new MailService({ schema: req.schema });
            const verificationUrl = `${env.PUBLIC_URL}/verify-email?token=${verificationToken}`;

            await mailService.send({
                to: email,
                subject: 'Verify your email address',
                html: `
					<h2>Email Verification</h2>
					<p>Please verify your email address by clicking the link below:</p>
					<p><a href="${verificationUrl}">Verify Email</a></p>
					<p>Or copy and paste this link into your browser:</p>
					<p>${verificationUrl}</p>
					<p>This link will expire in 24 hours.</p>
				`
            });

            logger.info(`Verification email resent to ${email}`);

            return res.json({
                success: true,
                message: 'If an unverified account exists, a new verification email has been sent.'
            });

        } catch (error) {
            logger.error('Resend verification error:', error);

            return res.status(500).json({
                success: false,
                message: 'Failed to resend verification email. Please try again.'
            });
        }
    });
};