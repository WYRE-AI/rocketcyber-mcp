import { RocketCyberClient } from '@wyre-ai/node-rocketcyber';
import { McpServerConfig } from '../types/mcp.js';
import { Logger } from '../utils/logger.js';

export class RocketCyberService {
  private client: RocketCyberClient | null = null;
  private logger: Logger;
  private config: McpServerConfig;
  private initializationPromise: Promise<void> | null = null;

  constructor(config: McpServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  private async ensureClient(): Promise<RocketCyberClient> {
    if (!this.client) {
      await this.ensureInitialized();
    }
    return this.client!;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }
    if (this.client) return;
    this.initializationPromise = this.initialize();
    await this.initializationPromise;
  }

  private async initialize(): Promise<void> {
    const { apiKey, region } = this.config.rocketcyber;
    if (!apiKey) {
      throw new Error('Missing required RocketCyber credentials: ROCKETCYBER_API_KEY is required');
    }

    this.logger.info('Initializing RocketCyber client...');
    this.client = new RocketCyberClient({
      apiKey,
      region: (region || 'us') as any
    });
    this.logger.info('RocketCyber client initialized successfully');
  }

  async getAccount(params?: any): Promise<any> {
    const client = await this.ensureClient();
    return client.account.get(params);
  }

  async listAgents(params?: any): Promise<any> {
    const client = await this.ensureClient();
    return client.agents.list(params);
  }

  async listIncidents(params?: any): Promise<any> {
    const client = await this.ensureClient();
    return client.incidents.list(params);
  }

  async listEvents(params?: any): Promise<any> {
    const client = await this.ensureClient();
    return client.events.list(params);
  }

  async getEventSummary(params?: any): Promise<any> {
    const client = await this.ensureClient();
    return client.events.getSummary(params);
  }

  async listFirewalls(params?: any): Promise<any> {
    const client = await this.ensureClient();
    return client.firewalls.list(params);
  }

  async listApps(params?: any): Promise<any> {
    const client = await this.ensureClient();
    return client.apps.list(params);
  }

  async getDefender(params?: any): Promise<any> {
    const client = await this.ensureClient();
    return client.defender.get(params);
  }

  async getOffice(params?: any): Promise<any> {
    const client = await this.ensureClient();
    return client.office.get(params);
  }

  /**
   * Reinitialize the client with new credentials.
   * Used in gateway mode where credentials come from request headers.
   */
  updateCredentials(apiKey: string, region?: string): void {
    this.config = {
      ...this.config,
      rocketcyber: { apiKey, region: region || 'us' }
    };
    // Force re-initialization on next call
    this.client = null;
    this.initializationPromise = null;
    this.logger.debug('RocketCyber credentials updated from gateway headers');
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getAccount();
      return true;
    } catch {
      return false;
    }
  }
}
