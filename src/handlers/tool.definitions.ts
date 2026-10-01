export interface McpTool {
  name: string;
  description: string;
  annotations?: {
    readOnlyHint?: boolean;
  };
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: McpTool[] = [
  {
    name: 'rocketcyber_test_connection',
    description: 'Test the connection to RocketCyber API',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'rocketcyber_get_account',
    description: 'Get RocketCyber account information',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'number', description: 'Account ID (optional, defaults to current account)' }
      },
      required: []
    }
  },
  {
    name: 'rocketcyber_list_agents',
    description: 'List monitored agents/endpoints in RocketCyber',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number' },
        pageSize: { type: 'number', description: 'Results per page' },
        sort: { type: 'string', description: 'Sort field' },
        accountId: { type: 'number', description: 'Filter by account ID' },
        connectivity: { type: 'string', description: 'Filter by connectivity status (online/offline)' },
        hostname: { type: 'string', description: 'Filter by hostname' },
        platform: { type: 'string', description: 'Filter by platform' },
        dates: { type: 'string', description: 'Date range filter' }
      },
      required: []
    }
  },
  {
    name: 'rocketcyber_list_incidents',
    description: 'List security incidents in RocketCyber. By default, long free-text fields (description, remediation) are truncated to ~300 characters, and the total response is capped at ~40,000 characters (a size cap) — if a page does not fit, only the first incidents are returned and the message says how many; use a smaller pageSize with page to paginate through the rest. Pass verbose: true for full untruncated text.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number' },
        pageSize: { type: 'number', description: 'Results per page' },
        sort: { type: 'string', description: 'Sort field' },
        accountId: { type: 'number', description: 'Filter by account ID' },
        status: { type: 'string', description: 'Filter by status' },
        dates: { type: 'string', description: 'Date range filter' },
        severity: { type: 'string', description: 'Filter by severity' },
        title: { type: 'string', description: 'Filter by title' },
        verbose: { type: 'boolean', description: 'Return full untruncated description/remediation text (default false: truncated to ~300 characters)' }
      },
      required: []
    }
  },
  {
    name: 'rocketcyber_list_events',
    description: 'List security events in RocketCyber. Requires appId - unlike every other list_* tool here, ' +
      'the underlying RocketCyber API rejects this specific endpoint outright (400 "appId is required") if it\'s ' +
      'omitted, regardless of any other filter supplied. Each RocketCyber "app" is a distinct monitored ' +
      'integration/module (Defender Manager, Office 365 Risk Detection, Datto Ransomware Detection, etc.) - events ' +
      'are always scoped to exactly one. Call rocketcyber_list_apps to see every app this account has and its ID, ' +
      'or rocketcyber_get_event_summary first (no appId needed) to see actual per-app event counts for this ' +
      'account and pick the one with data rather than guessing.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'number', description: 'REQUIRED. The RocketCyber app/module ID to scope events to (e.g. 34 = Defender Manager). See the tool description for how to discover the right value.' },
        page: { type: 'number', description: 'Page number' },
        pageSize: { type: 'number', description: 'Results per page' },
        sort: { type: 'string', description: 'Sort field' },
        accountId: { type: 'number', description: 'Filter by account ID' },
        eventType: { type: 'string', description: 'Filter by event type' },
        severity: { type: 'string', description: 'Filter by severity' },
        dates: { type: 'string', description: 'Date range filter' },
        hostname: { type: 'string', description: 'Filter by hostname' }
      },
      required: ['appId']
    }
  },
  {
    name: 'rocketcyber_get_event_summary',
    description: 'Get event summary/statistics from RocketCyber',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'number', description: 'Account ID' },
        dates: { type: 'string', description: 'Date range filter' }
      },
      required: []
    }
  },
  {
    name: 'rocketcyber_list_firewalls',
    description: 'List firewall devices in RocketCyber',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number' },
        pageSize: { type: 'number', description: 'Results per page' },
        sort: { type: 'string', description: 'Sort field' },
        accountId: { type: 'number', description: 'Filter by account ID' },
        connectivity: { type: 'string', description: 'Filter by connectivity status' },
        hostname: { type: 'string', description: 'Filter by hostname' },
        vendor: { type: 'string', description: 'Filter by vendor' }
      },
      required: []
    }
  },
  {
    name: 'rocketcyber_list_apps',
    description: 'List managed apps in RocketCyber',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number' },
        pageSize: { type: 'number', description: 'Results per page' },
        sort: { type: 'string', description: 'Sort field' },
        accountId: { type: 'number', description: 'Filter by account ID' },
        status: { type: 'string', description: 'Filter by status' },
        name: { type: 'string', description: 'Filter by name' }
      },
      required: []
    }
  },
  {
    name: 'rocketcyber_get_defender',
    description: 'Get Windows Defender status from RocketCyber',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'number', description: 'Account ID' }
      },
      required: []
    }
  },
  {
    name: 'rocketcyber_get_office',
    description: 'Get Office 365 status from RocketCyber',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'number', description: 'Account ID' }
      },
      required: []
    }
  }
];
