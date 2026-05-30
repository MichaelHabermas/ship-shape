// Composes FleetGraph chat and notification assistant surfaces inside the app shell.
import { FleetGraphChatProbe, type FleetGraphChatProbeRequest } from '@/components/FleetGraphChatProbe';
import {
  FleetGraphNotificationsProbe,
  type FleetGraphNotificationProbeItem,
} from '@/components/FleetGraphNotificationsProbe';
import { useFleetGraphPageContext } from '@/contexts/FleetGraphPageContext';

export function FleetGraphAssistantLayer({
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
