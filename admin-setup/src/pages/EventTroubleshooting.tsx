import { Link } from 'react-router-dom';
import styles from './EventTroubleshooting.module.css';

export const TROUBLESHOOTING_DOC_HREF = '/guides/kbm-connect-event-troubleshooting.docx';

const START = [
  {
    src: '/guides/troubleshooting/one-or-many.jpg',
    alt: 'One attendee with a phone, next to a whole room of attendees with phones',
    title: '1. One person, or everyone?',
    body: 'One person: use the matching problem below. A lot of people, and the app fails on venue Wi-Fi and on cell data: skip to the whole room is stuck.',
  },
  {
    src: '/guides/troubleshooting/reopen.jpg',
    alt: 'A thumb swiping the KBM Connect app away, then opening it again',
    title: '2. Close the app completely',
    body: 'Have them swipe KBM Connect off the phone, so it is fully closed, then open it again. Do this before you change anything in admin.',
  },
  {
    src: '/guides/troubleshooting/right-event.jpg',
    alt: 'The app home screen with the event name at the top and a check mark',
    title: '3. Are they in this event?',
    body: 'The event name at the top of the app must be this event. If it is blank or a different name, they joined the wrong event, or this event is Inactive on All events.',
  },
  {
    src: '/guides/troubleshooting/alerts-on.jpg',
    alt: 'Phone settings with KBM Connect notifications turned on',
    title: '4. Are notifications on?',
    body: 'On their phone: Settings, then Notifications, then KBM Connect, then Allow. If that switch is off, the phone will not ring. The message can still show inside the app.',
  },
] as const;

const ISSUES: { title: string; src: string; alt: string; steps: string[] }[] = [
  {
    title: 'Can’t sign in',
    src: '/guides/troubleshooting/sign-in.jpg',
    alt: 'Sign-in screen with a wrong-password message',
    steps: [
      'In cadmin, open Members, find the person, and set a temporary password (8+ characters). They’ll change it when they sign in.',
      'If they see “Change password,” the temporary password worked.',
      'Reset email missing: check spam, or set the password yourself.',
      'Signed in but no content: they signed in with the wrong email, joined the wrong event, or the event is set to Inactive.',
    ],
  },
  {
    title: 'Logo stays up, or the app flashes',
    src: '/guides/troubleshooting/splash.jpg',
    alt: 'Logo screen then the Info page',
    steps: [
      'A single blink on first launch is normal. If it continues, have them close and reopen the app.',
      'If the logo stays on the screen, have them close the app and open it again. If the venue Wi-Fi is weak, ask them to try their phone’s own cell data.',
      'If the app closes by itself, have them open it once more. If it keeps closing, tell KBM whether it is an iPhone or an Android. Do not ask them to delete the app unless KBM tells you to.',
    ],
  },
  {
    title: 'A screen is missing',
    src: '/guides/troubleshooting/menu.jpg',
    alt: 'App menu with one item turned off',
    steps: [
      'Agenda, 1:1 meetings, Solution Providers, badge scan, and session check-in can be turned off.',
      'Open the event, then Edit event, then In-app menu. Turn the missing item on and save.',
      'The attendee must close and reopen the app. If that switch is not on the page, ask KBM to turn the item on.',
    ],
  },
  {
    title: 'No phone alert',
    src: '/guides/troubleshooting/paused.jpg',
    alt: 'Event notifications switch set to paused',
    steps: [
      'On the event page, check Event notifications. If it says Paused, no one gets alerts, including chat. Turn it back on.',
      'Announcements still show in the app when the phone does not ring.',
      '1:1 reminders go out about 5 minutes before. Do not delete a meeting to resend the alert.',
      'Chat alerts don’t send if the person already has that chat open.',
      'If “Meeting starting soon” or “Rate your meeting” arrives at the wrong time, open the event and set Event timezone to the venue. Tucson is Arizona. Orlando is Eastern.',
    ],
  },
  {
    title: 'Badge, meetings, live wall',
    src: '/guides/troubleshooting/badge.jpg',
    alt: 'A badge QR code and a meeting time',
    steps: [
      'Turn Scan badge on under Edit event, In-app menu, then close and reopen. A second scan says already scanned.',
      'Meeting time is the event time, not the phone’s home time zone.',
      'Live wall blank: confirm it is on and refresh. Try another network if venue Wi-Fi blocks it.',
    ],
  },
  {
    title: 'The whole room is stuck',
    src: '/guides/troubleshooting/room.jpg',
    alt: 'A few phones on Wi-Fi versus a full outage',
    steps: [
      'If only a few people are stuck, help each person on their own phone. Do not change the event because of one person.',
      'If many people cannot use the app on the venue Wi-Fi and also cannot use it on their phone’s cell data, stop making changes. Write down the time and what they were trying to do, then call KBM.',
      'Do not turn the event off, and do not pause notifications, to try to fix a slow app. Do not upload a large batch of photos while people are stuck. Call KBM. Changes to the app itself are handled by KBM, not from this page.',
    ],
  },
];

export default function EventTroubleshooting() {
  return (
    <div className={styles.page}>
      <p className={styles.back}>
        <Link to="/">← All events</Link>
      </p>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>KBM Connect</p>
          <h1>Event troubleshooting</h1>
          <p className={styles.lead}>
            Most problems affect one phone, not the whole event.
          </p>
        </div>
        <a className={styles.download} href={TROUBLESHOOTING_DOC_HREF} download>
          Download Word guide
        </a>
      </header>

      <h2>Check these four things first</h2>
      <p className={styles.intro}>Go in order. These are questions to ask the attendee before you change the event.</p>
      <div className={styles.startGrid}>
        {START.map((item) => (
          <article key={item.title} className={styles.startCard}>
            <img src={item.src} alt={item.alt} />
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>

      <div className={styles.issues}>
        {ISSUES.map((issue) => (
          <article key={issue.title} className={styles.issue}>
            <img src={issue.src} alt={issue.alt} />
            <div>
              <h2>{issue.title}</h2>
              <ul>
                {issue.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <section className={styles.send}>
        <h2>What to send KBM</h2>
        <p>
          The person’s name, iPhone or Android, what they tapped, the exact words on the screen, and the time. A
          photo of the screen helps.
        </p>
      </section>
    </div>
  );
}
