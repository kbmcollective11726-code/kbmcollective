import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Linking,
  ScrollView,
  useWindowDimensions,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { isAppMenuItemVisible } from '../lib/effectiveEventMenu';
import { effectiveCanShowSessionCheckIn } from '../lib/rolePreview';
import { useRolePreviewStore } from '../stores/rolePreviewStore';
import { useRolePreviewContext } from '../hooks/useRolePreviewContext';
import { RolePreviewMenuButton, RolePreviewPicker } from './RolePreviewBanner';
import {
  Menu,
  X,
  Users,
  ImageIcon,
  LayoutGrid,
  Tv,
  User,
  Edit3,
  Bell,
  Shield,
  LogOut,
  ChevronRight,
  Home,
  Calendar,
  Trophy,
  Store,
  Building2,
  BookOpen,
  QrCode,
  FileText,
  ClipboardCheck,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';
import { supabase, withRetryAndRefresh } from '../lib/supabase';
import { setAppBadgeCount } from '../lib/pushNotifications';
import { colors } from '../constants/colors';
import type { EventSponsor } from '../lib/types';
import { logSponsorClick, type SponsorClickPlacement } from '../lib/logSponsorClick';
import { openExternalUrl } from '../lib/openExternalUrl';
import { SponsorMark } from './SponsorMark';

/** New columns, when missing, follow legacy `show_in_hamburger`. */
function sponsorUsesHamburgerHeader(s: EventSponsor): boolean {
  const h = s.show_in_hamburger_header;
  if (h === true) return true;
  if (h === false) return false;
  return s.show_in_hamburger === true;
}

function sponsorUsesHamburgerFooter(s: EventSponsor): boolean {
  const f = s.show_in_hamburger_footer;
  if (f === true) return true;
  if (f === false) return false;
  return s.show_in_hamburger === true;
}

function getLiveWallBaseUrl(): string {
  const fromEnv =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_LIVE_WALL_URL
      ? String(process.env.EXPO_PUBLIC_LIVE_WALL_URL).trim().replace(/\/+$/, '')
      : '') || '';
  const extra = Constants.expoConfig?.extra as { liveWallUrl?: string } | undefined;
  const fromExtra = (extra?.liveWallUrl && String(extra.liveWallUrl).trim().replace(/\/+$/, '')) || '';
  return fromEnv || fromExtra || 'http://localhost:3000';
}

type HamburgerMenuProps = {
  onLogout?: () => void;
};

export default function HamburgerMenu({ onLogout }: HamburgerMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [isVendorRep, setIsVendorRep] = useState(false);
  const [rolePreviewOpen, setRolePreviewOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const { currentEvent, adminCheckTick } = useEventStore();
  const previewRole = useRolePreviewStore((s) => s.previewRole);
  const { applyEventAdmin, applyVendorRep } = useRolePreviewContext();
  const isPlatformAdmin = user?.is_platform_admin === true;
  const effectiveIsEventAdmin = applyEventAdmin(isEventAdmin);
  const effectiveIsVendorRep = applyVendorRep(isVendorRep);
  const [sponsorsMenuHeader, setSponsorsMenuHeader] = useState<EventSponsor[]>([]);
  const [sponsorsMenuFooter, setSponsorsMenuFooter] = useState<EventSponsor[]>([]);

  const fetchUnreadCount = useCallback(() => {
    if (!user?.id) return;
    if (!currentEvent?.id) {
      setUnreadNotifications(0);
      setAppBadgeCount(0);
      return;
    }
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
      .eq('event_id', currentEvent.id)
      .then(({ count }) => {
        const n = count ?? 0;
        setUnreadNotifications(n);
        setAppBadgeCount(n);
      });
  }, [user?.id, currentEvent?.id]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (visible) fetchUnreadCount();
  }, [visible, fetchUnreadCount]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel('notifications-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, fetchUnreadCount)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, fetchUnreadCount)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, fetchUnreadCount]);

  const tryAnyEventAdmin = useCallback(async () => {
    if (!user?.id) {
      setIsEventAdmin(false);
      return;
    }
    try {
      const data = await withRetryAndRefresh(async () => {
        const { data: d, error } = await supabase
          .from('event_members')
          .select('event_id')
          .eq('user_id', user.id)
          .in('role', ['admin', 'super_admin'])
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return d;
      });
      setIsEventAdmin(data != null);
    } catch {
      // keep previous state on error so Event admin menu doesn't disappear
    }
  }, [user?.id]);

  const fetchEventAdminStatus = useCallback(async () => {
    if (!user?.id) {
      setIsEventAdmin(false);
      return;
    }
    if (currentEvent?.id) {
      try {
        const data = await withRetryAndRefresh(async () => {
          const { data: d, error } = await supabase
            .from('event_members')
            .select('role, roles')
            .eq('event_id', currentEvent.id)
            .eq('user_id', user.id)
            .single();
          if (error) throw error;
          return d;
        });
        const row = data as { role?: string; roles?: string[] } | null;
        const role = row?.role ?? 'attendee';
        const roles = Array.isArray(row?.roles) ? row.roles : [];
        setIsEventAdmin(role === 'admin' || role === 'super_admin' || roles.includes('admin') || roles.includes('super_admin'));
      } catch {
        await tryAnyEventAdmin();
      }
      return;
    }
    await tryAnyEventAdmin();
  }, [user?.id, currentEvent?.id, tryAnyEventAdmin]);

  const fetchVendorRepStatus = useCallback(async () => {
    if (!user?.id || !currentEvent?.id) {
      setIsVendorRep(false);
      return;
    }
    try {
      const repsRes = await supabase
        .from('vendor_booth_reps')
        .select('booth_id, vendor_booths!inner(event_id)')
        .eq('user_id', user.id)
        .eq('vendor_booths.event_id', currentEvent.id);
      if (!repsRes.error && (repsRes.data?.length ?? 0) > 0) {
        setIsVendorRep(true);
        return;
      }
      const legacy = await supabase
        .from('vendor_booths')
        .select('id')
        .eq('event_id', currentEvent.id)
        .eq('contact_user_id', user.id)
        .limit(1)
        .maybeSingle();
      setIsVendorRep(!legacy.error && legacy.data != null);
    } catch {
      setIsVendorRep(false);
    }
  }, [user?.id, currentEvent?.id]);

  useEffect(() => {
    fetchEventAdminStatus();
  }, [fetchEventAdminStatus, adminCheckTick]);

  useEffect(() => {
    fetchVendorRepStatus();
  }, [fetchVendorRepStatus, adminCheckTick]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && user?.id) {
        fetchEventAdminStatus();
        fetchVendorRepStatus();
      }
    });
    return () => sub.remove();
  }, [user?.id, fetchEventAdminStatus, fetchVendorRepStatus]);

  // Refetch when menu opens so she always sees latest role (e.g. just made admin, or event selected after load)
  useEffect(() => {
    if (visible && user?.id) {
      fetchEventAdminStatus();
      fetchVendorRepStatus();
    }
  }, [visible, user?.id, fetchEventAdminStatus, fetchVendorRepStatus]);

  useEffect(() => {
    setSponsorsMenuHeader([]);
    setSponsorsMenuFooter([]);
  }, [currentEvent?.id]);

  useEffect(() => {
    if (!currentEvent?.id || !visible) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('event_sponsors')
        .select(
          'id, company_name, logo_url, website_url, tier_label, sort_order, show_on_info_screen, show_in_hamburger, show_in_hamburger_header, show_in_hamburger_footer, show_on_schedule, show_on_feed, is_active'
        )
        .eq('event_id', currentEvent.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      if (error) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('HamburgerMenu: event_sponsors fetch failed', error);
        }
        setSponsorsMenuHeader([]);
        setSponsorsMenuFooter([]);
        return;
      }
      const rows = (data ?? []) as EventSponsor[];
      setSponsorsMenuHeader(rows.filter(sponsorUsesHamburgerHeader));
      setSponsorsMenuFooter(rows.filter(sponsorUsesHamburgerFooter));
    })();
    return () => {
      cancelled = true;
    };
  }, [currentEvent?.id, visible]);

  const close = () => setVisible(false);

  const navigate = (path: string) => {
    close();
    router.push(path as any);
  };

  // For profile sub-pages, pass current path so back button returns to the page user was on
  const returnTo = pathname && pathname !== '/' ? pathname : '/(tabs)/home';
  const navigateToProfileScreen = (screen: string) => {
    close();
    router.push(`${screen}?from=${encodeURIComponent(returnTo)}` as any);
  };

  const handleLogout = async () => {
    close();
    try {
      await logout();
      onLogout?.();
      router.replace('/(auth)/login');
    } catch {
      router.replace('/(auth)/login');
    }
  };

  const openLiveWall = () => {
    close();
    const base = getLiveWallBaseUrl();
    const url = currentEvent?.id ? `${base}/wall?event=${currentEvent.id}` : base;
    Linking.openURL(url).catch(() => {});
  };

  /** Slightly narrower drawer — easier to scan, less “wide sheet” on phone. */
  const menuWidth = Math.min(width * 0.7, 288);
  /** Match `CompactSponsorStrip` stacked row height for the drawer width. */
  const footerSponsorLogoH = Math.min(120, Math.max(72, Math.round(menuWidth / 3.35)));

  const openSponsorLink = useCallback(
    async (s: EventSponsor, placement: SponsorClickPlacement) => {
      if (!s.website_url?.trim()) return;
      const opened = await openExternalUrl(s.website_url);
      if (opened && currentEvent?.id) {
        void logSponsorClick({ eventId: currentEvent.id, sponsorId: s.id, placement });
      }
    },
    [currentEvent?.id]
  );

  const openMenu = () => {
    setVisible(true);
    // Refetch admin status as soon as they open the menu so "Event admin" shows for admins
    fetchEventAdminStatus();
  };

  return (
    <>
      <TouchableOpacity
        onPress={openMenu}
        style={styles.trigger}
        hitSlop={12}
        activeOpacity={0.85}
      >
        <View>
          <Menu size={24} color={colors.text} />
          {unreadNotifications > 0 && (
            <View style={styles.badgeDot} pointerEvents="none">
              <Text style={styles.badgeDotText}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={close}>
          <Pressable
            style={[styles.drawer, { width: menuWidth, paddingTop: insets.top }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.drawerHeader}>
              <View style={styles.drawerHeaderLeft}>
                <Text style={styles.drawerTitle}>Menu</Text>
                {sponsorsMenuHeader.slice(0, 2).map((s, i) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.headerSponsorBtn, i > 0 ? { marginLeft: 8 } : null]}
                    onPress={() => openSponsorLink(s, 'hamburger_header')}
                    activeOpacity={s.website_url ? 0.75 : 1}
                    disabled={!s.website_url}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityLabel={s.company_name}
                    accessibilityRole={s.website_url ? 'link' : 'text'}
                  >
                    {s.logo_url?.trim() ? (
                      <View style={styles.headerSponsorImageWrap} pointerEvents="none">
                        <SponsorMark uri={s.logo_url} style={styles.headerSponsorImg} />
                      </View>
                    ) : (
                      <Text style={styles.headerSponsorName} numberOfLines={1}>
                        {s.company_name}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.drawerHeaderClose}>
                <TouchableOpacity onPress={close} hitSlop={12} accessibilityLabel="Close menu">
                  <X size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              style={styles.menuList}
              contentContainerStyle={styles.menuListContent}
              showsVerticalScrollIndicator={false}
            >
              <MenuItem icon={Home} label="Info" onPress={() => navigate('/(tabs)/home')} />
              <MenuItem icon={ImageIcon} label="Feed" onPress={() => navigate('/(tabs)/feed')} />
              {isAppMenuItemVisible(currentEvent, 'menu_show_agenda') && (
                <MenuItem icon={Calendar} label="Agenda" onPress={() => navigate('/(tabs)/schedule')} />
              )}
              <MenuItem icon={Users} label="Community" onPress={() => navigate('/(tabs)/community')} />
              <MenuItem icon={Trophy} label="Rank" onPress={() => navigate('/(tabs)/leaderboard')} />
              {isAppMenuItemVisible(currentEvent, 'menu_show_solution_providers') && (
                <MenuItem
                  icon={Building2}
                  label="Solution Providers"
                  onPress={() =>
                    navigate(
                      `/(tabs)/solution-providers?from=${encodeURIComponent(returnTo)}` as any
                    )
                  }
                />
              )}
              {isAppMenuItemVisible(currentEvent, 'menu_show_1on1') && (
                <MenuItem icon={Store} label="1:1 Meetings" onPress={() => navigate('/(tabs)/expo')} />
              )}
              {isAppMenuItemVisible(currentEvent, 'menu_show_scan_badge') && (
                <MenuItem
                  icon={QrCode}
                  label="Scan badge"
                  onPress={() => navigateToProfileScreen('/profile/badge-scan')}
                />
              )}
              {effectiveCanShowSessionCheckIn(currentEvent, isEventAdmin, isPlatformAdmin, previewRole) && (
                <MenuItem
                  icon={ClipboardCheck}
                  label="Session check-in"
                  onPress={() =>
                    navigate(`/(tabs)/profile/session-check-in?from=${encodeURIComponent(returnTo)}` as any)
                  }
                />
              )}
              {currentEvent?.id &&
                (effectiveIsEventAdmin || effectiveIsVendorRep) &&
                isAppMenuItemVisible(currentEvent, 'menu_show_notes') && (
                  <MenuItem
                    icon={FileText}
                    label="Notes"
                    onPress={() => navigateToProfileScreen('/profile/badge-notes')}
                  />
                )}
              <MenuItem icon={LayoutGrid} label="Photo book" onPress={() => navigate('/(tabs)/photo-book')} />
              {isAppMenuItemVisible(currentEvent, 'menu_show_live_wall') && (
                <MenuItem icon={Tv} label="Live wall" onPress={openLiveWall} />
              )}
              <MenuItem
                icon={BookOpen}
                label="How to use"
                onPress={() => navigateToProfileScreen('/profile/user-guide')}
              />
              <View style={styles.divider} />
              <MenuItem
                icon={User}
                label="My profile"
                onPress={() => navigate('/(tabs)/profile')}
              />
              <MenuItem
                icon={Edit3}
                label="Edit profile"
                onPress={() => navigateToProfileScreen('/profile/edit')}
              />
              <MenuItem
                icon={Bell}
                label="Notifications"
                badge={unreadNotifications > 0 ? unreadNotifications : undefined}
                onPress={() => navigateToProfileScreen('/profile/notifications')}
              />
              {effectiveIsEventAdmin && user && (
                <MenuItem
                  icon={Shield}
                  label="Event admin"
                  onPress={() => navigateToProfileScreen('/profile/admin')}
                />
              )}
              {isPlatformAdmin ? (
                <>
                  <View style={styles.divider} />
                  <RolePreviewMenuButton onPress={() => setRolePreviewOpen(true)} />
                </>
              ) : null}
              <View style={styles.divider} />
              <MenuItem
                icon={LogOut}
                label="Logout"
                onPress={handleLogout}
                labelStyle={styles.logoutLabel}
              />
              {sponsorsMenuFooter.length > 0 ? (
                <View style={styles.sponsorMenuSection}>
                  <View style={styles.sponsorMenuStrip}>
                    <Text style={styles.sponsorMenuTitle}>Mobile app sponsored by</Text>
                    {sponsorsMenuFooter.map((s, i) => (
                      <TouchableOpacity
                        key={s.id}
                        style={[styles.sponsorFooterRow, i > 0 ? styles.sponsorFooterRowSpacing : null]}
                        onPress={() => openSponsorLink(s, 'hamburger_footer')}
                        activeOpacity={s.website_url ? 0.75 : 1}
                        disabled={!s.website_url}
                        accessibilityLabel={s.company_name}
                      >
                        {s.tier_label ? <Text style={styles.sponsorMenuTier}>{s.tier_label}</Text> : null}
                        {s.logo_url?.trim() ? (
                          <View style={[styles.sponsorFooterLogoShell, { height: footerSponsorLogoH }]}>
                            <SponsorMark uri={s.logo_url} style={styles.sponsorFooterLogoImg} />
                          </View>
                        ) : (
                          <Text style={styles.sponsorMenuName} numberOfLines={2}>
                            {s.company_name}
                          </Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={styles.bottomSpacer} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <RolePreviewPicker visible={rolePreviewOpen} onClose={() => setRolePreviewOpen(false)} />
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onPress,
  labelStyle,
  badge,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  labelStyle?: object;
  badge?: number;
}) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Icon size={22} color={colors.textSecondary} />
      <Text style={[styles.menuItemLabel, labelStyle]}>{label}</Text>
      {badge != null && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
      <ChevronRight size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  trigger: {
    padding: 8,
    marginLeft: 4,
  },
  badgeDot: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeDotText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  overlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    backgroundColor: colors.background,
    marginRight: 0,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: 48,
  },
  /** “Menu” + inline sponsor mark(s) on the same row, left side. */
  drawerHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    marginRight: 8,
  },
  drawerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 0,
    marginRight: 10,
    letterSpacing: 0.2,
  },
  headerSponsorBtn: {
    width: 108,
    height: 34,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSponsorImageWrap: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headerSponsorImg: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.background,
  },
  headerSponsorName: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 72,
  },
  drawerHeaderClose: {
    flexShrink: 0,
  },
  menuList: {
    flex: 1,
  },
  menuListContent: {
    paddingTop: 8,
    paddingBottom: 70,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuItemLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  badge: {
    backgroundColor: colors.primary,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  logoutLabel: {
    color: colors.danger,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 6,
    marginHorizontal: 16,
  },
  bottomSpacer: {
    height: 14,
  },
  /** Full drawer width — inner strip matches Feed / Info `CompactSponsorStrip` band. */
  sponsorMenuSection: {
    width: '100%',
    paddingTop: 6,
    paddingBottom: 4,
    marginTop: 4,
  },
  sponsorMenuStrip: {
    width: '100%',
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 10,
    paddingBottom: 16,
  },
  sponsorMenuTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  sponsorFooterRow: {
    width: '100%',
    alignItems: 'stretch',
    paddingHorizontal: 6,
  },
  sponsorFooterRowSpacing: {
    marginTop: 12,
  },
  sponsorMenuTier: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 6,
    fontWeight: '500',
    textAlign: 'center',
    width: '100%',
    paddingHorizontal: 16,
  },
  sponsorFooterLogoShell: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  sponsorFooterLogoImg: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.background,
  },
  sponsorMenuName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
