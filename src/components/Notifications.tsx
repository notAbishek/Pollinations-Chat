/**
 * Notifications — bottom-right toast messages with spring enter/exit.
 */

import { motion, AnimatePresence } from 'motion/react';
import type { Notification } from '../types';

interface NotificationsProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

const TYPE_STYLES: Record<string, string> = {
  success: 'bg-card border-success/40 text-success',
  error: 'bg-card border-destructive/40 text-destructive',
  warning: 'bg-card border-warning/40 text-warning',
  info: 'bg-card border-border text-foreground',
};

function NotifIcon({ type }: { type: string }) {
  const cls = 'w-4 h-4 flex-shrink-0 mt-0.5';
  switch (type) {
    case 'success':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
    case 'error':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
    case 'warning':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
    default:
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  }
}

export default function Notifications({ notifications, onDismiss }: NotificationsProps) {
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 max-w-sm pointer-events-none">
      <AnimatePresence initial={false}>
        {notifications.map((n) => (
          <motion.div
            key={n.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className={`pointer-events-auto flex items-start gap-2 px-4 py-3 rounded-xl border shadow-lg ${TYPE_STYLES[n.type] ?? TYPE_STYLES.info}`}
          >
            <NotifIcon type={n.type} />
            <p className="text-sm flex-1 text-foreground">{n.message}</p>
            <button
              onClick={() => onDismiss(n.id)}
              className="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors"
              aria-label="Dismiss"
            >
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
