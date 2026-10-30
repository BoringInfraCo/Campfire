// Runs the actual Campfire Viewer proxy with fixed public demo records.
// No profile, token, Cloud endpoint, or SQLite database is opened here.
import { startCampfireViewer } from '../../dist/src/viewer/server.js';

const workspace = {
  id: 'ws_mac001_demo', teamId: 'team_mac001_demo', name: 'Campfire demo', status: 'active',
  createdBy: { kind: 'human', id: 'hum_demo' },
  createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z',
};
const task = {
  id: 'task_mac001_demo', workspaceId: workspace.id,
  title: 'Review the shared finding', description: 'A bounded task returned by the Viewer.',
  status: 'open', updatedAt: '2026-10-25T00:00:00.000Z',
};
const finding = {
  id: 'find_mac001_demo', workspaceId: workspace.id,
  summary: 'The second teammate can continue from shared work.',
  detail: 'The app displays this record only after an actor-bound Viewer read.',
  currentness: 'current',
};
const slice = (items) => ({ items, total: items.length, returned: items.length, truncated: false });
const context = {
  schemaVersion: 1, generatedAt: '2026-10-25T00:00:00.000Z',
  orientationCursor: 'con_mac001_demo',
  completeness: { fullHistoryIncluded: false, drillDownAvailable: true },
  workspace,
  goal: { id: 'goal_mac001_demo', workspaceId: workspace.id,
    title: 'Make shared work easy to inspect', status: 'active', updatedAt: '2026-10-25T00:00:00.000Z' },
  slices: {
    tasks: slice([task]), findings: slice([finding]), decisions: slice([]),
    blockers: slice([]), artifacts: slice([]), recentChanges: slice([]),
  },
};

const viewer = await startCampfireViewer({
  host: '127.0.0.1', port: 9415,
  call: async (method, params) => {
    if (method === 'list_workspaces') return [{ id: workspace.id, name: workspace.name,
      status: workspace.status, goalTitle: context.goal.title, openTaskCount: 1,
      updatedAt: workspace.updatedAt }];
    if (method === 'get_workspace_context' && params?.workspaceId === workspace.id) return context;
    throw new Error('Fixture has no result for this read');
  },
});
console.error(`MAC-001 fixture Viewer listening on ${viewer.url}`);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void viewer.close().then(() => process.exit(0)); });
}
