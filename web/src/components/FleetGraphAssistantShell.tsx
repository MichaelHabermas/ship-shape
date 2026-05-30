// Wraps FleetGraph page context with chat and notification assistant probes for the app shell.
import type { ReactNode } from 'react';
import { FleetGraphChatProbe, type FleetGraphChatProbeRequest } from '@/components/FleetGraphChatProbe';
import {
  FleetGraphNotificationsProbe,
  type FleetGraphNotificationProbeItem,
} from '@/components/FleetGraphNotificationsProbe';
import {
  FleetGraphPageContextProvider,
  useFleetGraphPageContext,
} from '@/contexts/FleetGraphPageContext';

function FleetGraphAssistantProbes({
  chatDiscussRequest,
  onDiscussNotification,
}: {
  chatDiscussRequest: FleetGraphChatProbeRequest | null;
  onDiscussNotification: (notification: FleetGraphNotificationProbeItem) => void;
}) {
  const pageContext = useFleetGraphPageContext();
  return (
    <>
      <FleetGraphChatProbe discussRequest={chatDiscussRequest} pageContext={pageContext} />
      <FleetGraphNotificationsProbe onDiscuss={onDiscussNotification} />
    </>
  );
}

export function FleetGraphAssistantShell({
  children,
  chatDiscussRequest,
  onDiscussNotification,
}: {
  children: ReactNode;
  chatDiscussRequest: FleetGraphChatProbeRequest | null;
  onDiscussNotification: (notification: FleetGraphNotificationProbeItem) => void;
}) {
  return (
    <FleetGraphPageContextProvider>
      {children}
      <FleetGraphAssistantProbes
        chatDiscussRequest={chatDiscussRequest}
        onDiscussNotification={onDiscussNotification}
      />
    </FleetGraphPageContextProvider>
  );
}
