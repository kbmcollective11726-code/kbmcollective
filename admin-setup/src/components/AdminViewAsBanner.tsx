import styles from './AdminViewAsBanner.module.css';

type Props = {
  memberName: string;
  onExit: () => void;
};

/** Shown while an event/platform admin is viewing a member's portal. */
export default function AdminViewAsBanner({ memberName, onExit }: Props) {
  return (
    <div className={styles.banner} role="status">
      <span>
        Viewing portal as <strong>{memberName}</strong> — you stay signed in as admin (view only).
      </span>
      <button type="button" className={styles.exitBtn} onClick={onExit}>
        Exit view
      </button>
    </div>
  );
}
