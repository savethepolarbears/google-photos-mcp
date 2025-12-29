import express from 'express';
import { randomBytes } from 'crypto';
import { createOAuthClient } from '../api/photos.js';
import { saveTokens } from './tokens.js';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { parseIdToken, resolveUserIdentity } from '../utils/googleUser.js';

/**
 * Sets up the authentication routes for the Express application.
 * Handles the OAuth 2.0 flow with Google, including redirection and callback handling.
 *
 * @param app - The Express application instance.
 */
export function setupAuthRoutes(app: express.Express): void {
  // Store state tokens to prevent CSRF attacks
  const authStates = new Map<string, { expires: number }>();
  
  // Clean up expired state tokens every 15 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [state, data] of authStates.entries()) {
      if (data.expires < now) {
        authStates.delete(state);
      }
    }
  }, 15 * 60 * 1000);
  
  // Main auth route - redirects to Google's OAuth page
  app.get('/auth', (req, res) => {
    try {
      const oauth2Client = createOAuthClient();
      
      // Generate a random state token
      const state = randomBytes(20).toString('hex');
      
      // Store the state token with a 10-minute expiration
      authStates.set(state, {
        expires: Date.now() + 10 * 60 * 1000, // 10 minutes
      });
      
      // Generate the auth URL
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: config.google.scopes,
        state,
        // Force approval to get a refresh token every time
        prompt: 'consent',
      });
      
      res.redirect(authUrl);
    } catch (error) {
      logger.error(`Auth error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).send('Authentication error');
    }
  });
  
  // OAuth callback route
  app.get('/auth/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      
      // Validate state token to prevent CSRF attacks
      if (!state || !authStates.has(state as string)) {
        logger.warn(`Invalid state token: ${state}`);
        return res.status(400).send('Invalid state parameter');
      }
      
      // Delete the used state token
      authStates.delete(state as string);
      
      if (!code) {
        logger.warn('No authorization code received');
        return res.status(400).send('No authorization code received');
      }
      
      // Exchange the code for tokens
      const oauth2Client = createOAuthClient();
      const { tokens } = await oauth2Client.getToken(code as string);

      if (!tokens.access_token || !tokens.refresh_token) {
        logger.error('Did not receive all required tokens');
        return res.status(500).send('Failed to get required tokens');
      }

      // Verify JWT signature before trusting the payload (CRITICAL security)
      const verifiedPayload = await parseIdToken(tokens.id_token, oauth2Client);
      const identity = resolveUserIdentity(verifiedPayload);

      if (!identity.userId) {
        logger.warn('Could not resolve user identity from ID token, generating fallback ID');
      }

      // Save the tokens
      await saveTokens(identity.userId, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date || 0,
        userEmail: identity.email,
        userId: identity.userId,
        retrievedAt: Date.now(),
      });

      logger.info(`Authentication successful for user ID: ${identity.userId}${identity.email ? ` (${identity.email})` : ''}`);
      
      // Success page
      res.send(`
        <html>
          <head>
            <title>Authentication Successful</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px; }
              .success { background-color: #d4edda; border-color: #c3e6cb; color: #155724; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
              h1 { color: #2c3e50; }
            </style>
          </head>
          <body>
            <div class="success">
              <h1>Authentication Successful</h1>
              <p>You have successfully authenticated with Google Photos.</p>
              <p>You can now close this window and use the Google Photos MCP server with Claude Desktop or Cursor IDE.</p>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      logger.error(`Callback error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).send('Authentication callback error');
    }
  });
  
  // Logout/disconnect route
  app.get('/auth/logout', (req, res) => {
    // Simple logout page with instructions
    res.send(`
      <html>
        <head>
          <title>Logout</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px; }
            .info { background-color: #d1ecf1; border-color: #bee5eb; color: #0c5460; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
            h1 { color: #2c3e50; }
          </style>
        </head>
        <body>
          <div class="info">
            <h1>Google Photos Logout</h1>
            <p>To completely disconnect from Google Photos, please visit your <a href="https://myaccount.google.com/permissions" target="_blank">Google Account permissions page</a> and revoke access to the "Google Photos MCP" application.</p>
          </div>
        </body>
      </html>
    `);
  });
}
