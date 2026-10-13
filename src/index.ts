#!/usr/bin/env node

import { RocketCyberMcpServer } from './mcp/server.js';
import { Logger } from './utils/logger.js';
import { loadEnvironmentConfig, mergeWithMcpConfig } from './utils/config.js';

async function main() {
  let logger: Logger | undefined;

  try {
    const envConfig = loadEnvironmentConfig();
    const mcpConfig = mergeWithMcpConfig(envConfig);

    logger = new Logger(envConfig.logging.level, envConfig.logging.format);
    logger.info('Starting RocketCyber MCP Server...');
    logger.debug('Configuration loaded', {
      serverName: mcpConfig.name,
      serverVersion: mcpConfig.version,
      hasCredentials: !!mcpConfig.rocketcyber.apiKey
    });

    if (envConfig.auth.mode !== 'gateway' && !mcpConfig.rocketcyber.apiKey) {
      logger.warn('Missing RocketCyber credentials. Tools will return errors until ROCKETCYBER_API_KEY is configured.');
    }

    const server = new RocketCyberMcpServer(mcpConfig, logger, envConfig);

    process.on('SIGINT', async () => {
      logger!.info('Received SIGINT, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger!.info('Received SIGTERM, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });

    await server.start();
  } catch (error) {
    if (logger) {
      logger.error('Failed to start RocketCyber MCP Server:', error);
    } else {
      console.error('Failed to start RocketCyber MCP Server:', error);
    }
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
