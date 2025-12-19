
import { createHash, randomBytes } from 'crypto';

import { Resend } from 'resend';

export default (router, { services, exceptions, env, logger }) => {
    const { UsersService, MailService } = services;

    // Helper function to generate verification token
    function generateVerificationToken() {
        return randomBytes(32).toString('hex');
    }

    // Helper function to hash token for storage
    function hashToken(token) {
        return createHash('sha256').update(token).digest('hex');
    }

    // POST /auth/register
    router.post('/register/old', async (req, res) => {
        logger.info('🚀 Custom register endpoint called - using Resend');
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
            // const mailService = new MailService({ schema: req.schema });
            const verificationUrl = `${env.PUBLIC_URL}/verify-email?token=${verificationToken}`;

            // await mailService.send({
            //     to: email,
            //     subject: 'Verify your email address',
            //     html: `
			// 		<h2>Welcome!</h2>
			// 		<p>Thank you for registering. Please verify your email address by clicking the link below:</p>
			// 		<p><a href="${verificationUrl}">Verify Email</a></p>
			// 		<p>Or copy and paste this link into your browser:</p>
			// 		<p>${verificationUrl}</p>
			// 		<p>This link will expire in 24 hours.</p>
			// 	`
            // });

            // try {
            //     const resendResponse = await fetch('https://api.resend.com/emails', {
            //         method: 'POST',
            //         headers: {
            //             'Authorization': `Bearer re_Hfimbfdi_3V7oLnVw81hb7hiSeZpbF9NM`,
            //             'Content-Type': 'application/json'
            //         },
            //         body: JSON.stringify({
            //             from: 'no-reply@peercheck.africa',
            //             to: email,
            //             subject: 'Verify your email address',
            //             html: `
            //             <h2>Welcome!</h2>
            //             <p>Thank you for registering. Please verify your email address by clicking the link below:</p>
            //             <p><a href="${verificationUrl}">Verify Email</a></p>
            //             <p>Or copy and paste this link into your browser:</p>
            //             <p>${verificationUrl}</p>
            //             <p>This link will expire in 24 hours.</p>
            //         `
            //         })
            //     });
            //
            //     if (!resendResponse.ok) {
            //         const errorData = await resendResponse.json();
            //         logger.error('Resend API error:', errorData);
            //         throw new Error(`Failed to send email: ${errorData.message || 'Unknown error'}`);
            //     }
            //
            //     const resendData = await resendResponse.json();
            //     logger.info(`Registration email sent to ${email}, Resend ID: ${resendData.id}`);
            //
            // } catch (emailError) {
            //     logger.error('Email sending failed:', emailError);
            //     // await usersService.deleteOne(user);
            //
            //     return res.status(500).json({
            //         success: false,
            //         message: 'Registration successful but email verification could not be sent. Please contact support.'
            //     });
            // }
            const resend = new Resend('re_Hfimbfdi_3V7oLnVw81hb7hiSeZpbF9NM');

            try {
                const { data, error } = await resend.emails.send({
                    from: 'no-reply@peercheck.africa',
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

                if (error) {
                    logger.error('Resend API error:', error);
                    throw new Error(`Failed to send email: ${error.message}`);
                }

                logger.info(`Registration email sent to ${email}, Email ID: ${data.id}`);

            } catch (emailError) {
                logger.error('Email sending failed:', emailError);

                // Optional: Delete the user if email fails
                // await usersService.deleteOne(user);

                return res.status(500).json({
                    success: false,
                    message: 'Registration successful but email verification could not be sent. Please contact support.'
                });
            }

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

    router.post('/register', async (req, res) => {
        logger.info('🚀 Custom register endpoint called - using Resend');
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
                status: 'draft',
                email_verification_token: hashedToken,
                verification_status: false
            });

            logger.info(`✅ User created with ID: ${user}`);

            // Send verification email
            const verificationUrl = `${env.PUBLIC_URL}/verify-email?token=${verificationToken}`;

            const resend = new Resend(env.EMAIL_SMTP_PASSWORD);

            logger.info(`📧 Attempting to send email to: ${email}`);
            logger.info(`📧 From address: onboarding@resend.dev`);
            logger.info(`📧 Verification URL: ${verificationUrl}`);

            try {
                const { data, error } = await resend.emails.send({
                    from: env.EMAIL_FROM,
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

                if (error) {
                    logger.error('❌ Resend API error details:', {
                        message: error.message,
                        name: error.name,
                        statusCode: error.statusCode,
                        fullError: JSON.stringify(error, null, 2)
                    });
                    throw error;
                }

                logger.info(`✅ Registration email sent successfully! Email ID: ${data.id}`);

                return res.json({
                    success: true,
                    message: 'Registration successful. Please check your email to verify your account.'
                });

            } catch (emailError) {
                logger.error('❌ Email sending failed:', {
                    message: emailError.message,
                    stack: emailError.stack,
                    fullError: JSON.stringify(emailError, null, 2)
                });

                // Optional: Delete the user if email fails
                // await usersService.deleteOne(user);

                return res.status(500).json({
                    success: false,
                    message: 'Registration successful but email verification could not be sent. Please contact support.',
                    debug: emailError.message // Remove this in production
                });
            }

        } catch (error) {
            logger.error('❌ Registration error:', {
                message: error.message,
                stack: error.stack
            });

            return res.status(500).json({
                success: false,
                message: 'Registration failed. Please try again.'
            });
        }
    });

    router.post('/register/new', async (req, res) => {
        logger.info('🚀 Custom register endpoint called - using Resend');
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
                status: 'draft',
                email_verification_token: hashedToken,
                verification_status: false
            });

            logger.info(`✅ User created with ID: ${user}`);

            // Send verification email using direct HTTP request
            const verificationUrl = `${env.PUBLIC_URL}/verify-email?token=${verificationToken}`;

            try {
                logger.info('📧 Sending email via direct HTTP request to Resend...');

                const response = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.EMAIL_SMTP_PASSWORD}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'onboarding@resend.dev',
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
                    })
                });

                const responseText = await response.text();
                logger.info(`Resend API response status: ${response.status}`);
                logger.info(`Resend API response body: ${responseText}`);

                if (!response.ok) {
                    throw new Error(`Resend API error: ${response.status} - ${responseText}`);
                }

                const data = JSON.parse(responseText);
                logger.info(`✅ Registration email sent successfully! Email ID: ${data.id}`);

                return res.json({
                    success: true,
                    message: 'Registration successful. Please check your email to verify your account.'
                });

            } catch (emailError) {
                logger.error('❌ Email sending failed:', {
                    message: emailError.message,
                    stack: emailError.stack
                });

                return res.status(500).json({
                    success: false,
                    message: 'Registration successful but email verification could not be sent. Please contact support.',
                    debug: emailError.message
                });
            }

        } catch (error) {
            logger.error('❌ Registration error:', {
                message: error.message,
                stack: error.stack
            });

            return res.status(500).json({
                success: false,
                message: 'Registration failed. Please try again.'
            });
        }
    });

    router.get('/test-resend', async (req, res) => {
        try {
            const resend = new Resend(env.EMAIL_SMTP_PASSWORD);

            const { data, error } = await resend.emails.send({
                from: 'onboarding@resend.dev', // Use test domain first
                to: 'delivered@resend.dev', // Resend's test email
                subject: 'Test Email',
                html: '<p>Test</p>'
            });

            if (error) {
                return res.json({ success: false, error });
            }

            return res.json({ success: true, data });
        } catch (error) {
            return res.json({ success: false, error: error.message });
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

    router.post('/forgot-password', async (req, res) => {
        logger.info('🔐 Forgot password request received');

        try {
            const { email } = req.body;

            // Validate email
            if (!email) {
                return res.status(422).json({
                    success: false,
                    message: 'Email is required'
                });
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(422).json({
                    success: false,
                    message: 'Invalid email format'
                });
            }

            const usersService = new UsersService({ schema: req.schema });

            // Find user by email
            const users = await usersService.readByQuery({
                filter: { email: { _eq: email } },
                limit: 1
            });

            // Always return success even if user doesn't exist (security best practice)
            if (users.length === 0) {
                logger.info(`Password reset requested for non-existent email: ${email}`);
                return res.json({
                    success: true,
                    message: 'If an account with that email exists, a password reset link has been sent.'
                });
            }

            const user = users[0];

            // Generate reset token
            const resetToken = generateVerificationToken();
            const hashedToken = hashToken(resetToken);
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

            // Store hashed token and expiry in user record
            await usersService.updateOne(user.id, {
                email_verification_token: hashedToken,
                verification_token_expires: expiresAt
            });

            // Send password reset email
            const resetUrl = `${env.PUBLIC_URL}/reset-password?token=${resetToken}`;

            try {
                const response = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.EMAIL_SMTP_PASSWORD}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: env.EMAIL_FROM || 'onboarding@resend.dev',
                        to: email,
                        subject: 'Reset Your Password',
                        html: `
                            <h2>Password Reset Request</h2>
                            <p>You requested to reset your password. Click the link below to proceed:</p>
                            <p><a href="${resetUrl}">Reset Password</a></p>
                            <p>Or copy and paste this link into your browser:</p>
                            <p>${resetUrl}</p>
                            <p>This link will expire in 1 hour.</p>
                            <p>If you didn't request this, please ignore this email.</p>
                        `
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    logger.error('Failed to send reset email:', errorText);
                    throw new Error('Failed to send email');
                }

                const data = await response.json();
                logger.info(`✅ Password reset email sent to ${email}, Email ID: ${data.id}`);

            } catch (emailError) {
                logger.error('❌ Email sending failed:', emailError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to send password reset email. Please try again.',
                    data: resetUrl
                });
            }

            return res.json({
                success: true,
                message: 'If an account with that email exists, a password reset link has been sent.',
                data: resetUrl
            });

        } catch (error) {
            logger.error('❌ Forgot password error:', error);
            return res.status(500).json({
                success: false,
                message: 'An error occurred. Please try again.',
                data: resetUrl
            });
        }
    });

    // Reset password - actually changes the password
    router.post('/reset-password', async (req, res) => {
        logger.info('🔑 Password reset attempt received');

        try {
            const { token, password } = req.body;

            // Validate inputs
            if (!token || !password) {
                return res.status(422).json({
                    success: false,
                    message: 'Token and password are required'
                });
            }

            // Validate password strength
            if (password.length < 8) {
                return res.status(422).json({
                    success: false,
                    message: 'Password must be at least 8 characters'
                });
            }

            const usersService = new UsersService({ schema: req.schema });

            // Hash the provided token to match stored hash
            const hashedToken = hashToken(token);

            // Find user with matching token that hasn't expired
            const users = await usersService.readByQuery({
                filter: {
                    _and: [
                        { email_verification_token: { _eq: hashedToken } },
                        { verification_token_expires: { _gt: new Date().toISOString() } }
                    ]
                },
                limit: 1
            });

            if (users.length === 0) {
                logger.warn('Invalid or expired reset token used');
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired reset token'
                });
            }

            const user = users[0];

            // Update password and clear reset token
            await usersService.updateOne(user.id, {
                password: password,
                email_verification_token: null,
                verification_token_expires: null
            });

            logger.info(`✅ Password successfully reset for user: ${user.email}`);

            // Optional: Send confirmation email
            // try {
            //     await fetch('https://api.resend.com/emails', {
            //         method: 'POST',
            //         headers: {
            //             'Authorization': `Bearer ${env.EMAIL_SMTP_PASSWORD}`,
            //             'Content-Type': 'application/json'
            //         },
            //         body: JSON.stringify({
            //             from: env.EMAIL_FROM || 'onboarding@resend.dev',
            //             to: user.email,
            //             subject: 'Password Changed Successfully',
            //             html: `
            //                 <h2>Password Changed</h2>
            //                 <p>Your password has been successfully changed.</p>
            //                 <p>If you didn't make this change, please contact support immediately.</p>
            //             `
            //         })
            //     });
            // } catch (emailError) {
            //     // Don't fail the request if confirmation email fails
            //     logger.warn('Failed to send password change confirmation:', emailError);
            // }

            return res.json({
                success: true,
                message: 'Password has been reset successfully. You can now login with your new password.'
            });

        } catch (error) {
            logger.error('❌ Reset password error:', error);
            return res.status(500).json({
                success: false,
                message: 'An error occurred. Please try again.'
            });
        }
    });

    // Optional: Verify reset token validity (useful for frontend)
    router.post('/verify-reset-token', async (req, res) => {
        try {
            const { token } = req.body;

            if (!token) {
                return res.status(422).json({
                    success: false,
                    message: 'Token is required'
                });
            }

            const usersService = new UsersService({ schema: req.schema });
            const hashedToken = hashToken(token);

            const users = await usersService.readByQuery({
                filter: {
                    _and: [
                        { email_verification_token: { _eq: hashedToken } },
                        { verification_token_expires: { _gt: new Date().toISOString() } }
                    ]
                },
                limit: 1
            });

            if (users.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }

            return res.json({
                success: true,
                message: 'Token is valid'
            });

        } catch (error) {
            logger.error('❌ Verify token error:', error);
            return res.status(500).json({
                success: false,
                message: 'An error occurred'
            });
        }
    });
};