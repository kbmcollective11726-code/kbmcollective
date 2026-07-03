import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { colors } from '../constants/colors';
import { theme } from '../constants/theme';
import type { EventSponsor } from '../lib/types';
import { logSponsorClick, type SponsorClickPlacement } from '../lib/logSponsorClick';
import { openExternalUrl } from '../lib/openExternalUrl';
import { SponsorMark } from './SponsorMark';

type Props = {
  sponsors: EventSponsor[];
  title?: string;
  /** Required for click analytics when a logo is tapped. */
  eventId?: string;
  placement?: SponsorClickPlacement;
  /**
   * `strip`: full-width band under label (Feed / Schedule).
   * `bare`: no band shell — rounded logo clips only (Info home matches cards below).
   */
  layout?: 'strip' | 'bare';
};

/** Horizontal scroll row (many sponsors). */
const ROW_H = 68;
const GAP = 6;

/** One sponsor: strip height for a full-width logo slot (`contain` inside). */
function singleSponsorLogoHeight(winW: number) {
  return Math.min(104, Math.max(56, Math.round(winW / 3.6)));
}

/** Info `bare`: wide horizontal banner slot so `contain` has room for wide + tall logos. */
function bareInfoBannerHeight(winW: number) {
  const h = Math.round(winW * 0.26);
  return Math.min(132, Math.max(88, h));
}

/** Max logos in a single full-width row before switching to horizontal scroll. */
const MAX_FLEX_ROW = 4;

/**
 * Full-width white band + small label + centered logo(s); label default “Mobile app sponsored by”.
 * Used on Feed, Schedule, and Info; parent may apply negative horizontal margin to bleed past padding.
 */
export default function CompactSponsorStrip({
  sponsors,
  title = 'Mobile app sponsored by',
  layout = 'strip',
  eventId,
  placement,
}: Props) {
  const { width: winW } = useWindowDimensions();
  if (sponsors.length === 0) return null;
  const bare = layout === 'bare';
  /** Match Schedule / section cards on Info (`nowNext`-style tiles). */
  const logoRadius = theme.sectionRadius;

  const onSponsorPress = async (s: EventSponsor) => {
    if (!s.website_url?.trim()) return;
    const opened = await openExternalUrl(s.website_url);
    if (opened && eventId && placement) {
      void logSponsorClick({ eventId, sponsorId: s.id, placement });
    }
  };

  if (sponsors.length === 1) {
    const s = sponsors[0]!;
    if (bare) {
      const bannerH = bareInfoBannerHeight(winW);
      return (
        <View style={styles.bareOuter} accessibilityLabel={title}>
          <Text style={styles.bareTitle}>{title}</Text>
          <TouchableOpacity
            style={styles.singleTouch}
            onPress={() => onSponsorPress(s)}
            activeOpacity={s.website_url ? 0.8 : 1}
            disabled={!s.website_url}
            accessibilityLabel={s.company_name}
          >
            {s.logo_url?.trim() ? (
              <View style={[styles.bareLogoClip, { height: bannerH, borderRadius: logoRadius }]}>
                <SponsorMark
                  uri={s.logo_url.trim()}
                  style={[styles.singleBannerImage, { borderRadius: logoRadius }]}
                />
              </View>
            ) : (
              <View style={[styles.bareFallbackBox, { borderRadius: logoRadius }]}>
                <Text style={styles.stackedFallback} numberOfLines={2}>
                  {s.company_name}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      );
    }
    const h = singleSponsorLogoHeight(winW);
    return (
      <View style={styles.wrap} accessibilityLabel={title}>
        <View style={styles.stripBand}>
          <Text style={styles.stripTitle}>{title}</Text>
          <TouchableOpacity
            style={styles.singleTouch}
            onPress={() => onSponsorPress(s)}
            activeOpacity={s.website_url ? 0.8 : 1}
            disabled={!s.website_url}
            accessibilityLabel={s.company_name}
          >
            {s.logo_url?.trim() ? (
              <View style={styles.singleLogoRow}>
                <View style={[styles.singleLogoMax, { height: h }]}>
                  <SponsorMark uri={s.logo_url.trim()} style={styles.singleBannerImage} />
                </View>
              </View>
            ) : (
              <View style={styles.fallbackBox}>
                <Text style={styles.fallback} numberOfLines={2}>
                  {s.company_name}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /** 2–4 sponsors: stack vertically so each logo gets full width (avoids squeezed columns + Android black pillarboxing). */
  if (sponsors.length <= MAX_FLEX_ROW && sponsors.length > 1) {
    const rowH = Math.min(84, Math.max(56, Math.round(winW / 4.2)));
    const rowHBare = Math.min(96, Math.max(72, Math.round(winW * 0.22)));
    if (bare) {
      return (
        <View style={styles.bareOuter} accessibilityLabel={title}>
          <Text style={styles.bareTitle}>{title}</Text>
          <View style={styles.bareStackedList}>
            {sponsors.map((s, i) => {
              const uri = s.logo_url?.trim();
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.stackedRow, i > 0 ? styles.stackedRowSpacing : null]}
                  onPress={() => onSponsorPress(s)}
                  activeOpacity={s.website_url ? 0.75 : 1}
                  disabled={!s.website_url}
                  accessibilityLabel={s.company_name}
                >
                  {uri ? (
                    <View
                      style={[
                        styles.stackedLogoWrap,
                        styles.bareLogoClip,
                        { height: rowHBare, borderRadius: logoRadius },
                      ]}
                    >
                      <SponsorMark uri={uri} style={[styles.stackedLogoImg, { borderRadius: logoRadius }]} />
                    </View>
                  ) : (
                    <Text style={styles.stackedFallback} numberOfLines={2}>
                      {s.company_name}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }
    return (
      <View style={styles.wrap} accessibilityLabel={title}>
        <View style={styles.stripBand}>
          <Text style={styles.stripTitle}>{title}</Text>
          <View style={styles.stackedList}>
            {sponsors.map((s, i) => {
              const uri = s.logo_url?.trim();
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.stackedRow, i > 0 ? styles.stackedRowSpacing : null]}
                  onPress={() => onSponsorPress(s)}
                  activeOpacity={s.website_url ? 0.75 : 1}
                  disabled={!s.website_url}
                  accessibilityLabel={s.company_name}
                >
                  {uri ? (
                    <View style={[styles.stackedLogoWrap, { height: rowH }]}>
                      <SponsorMark uri={uri} style={styles.stackedLogoImg} />
                    </View>
                  ) : (
                    <Text style={styles.stackedFallback} numberOfLines={2}>
                      {s.company_name}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  const itemW = Math.max(120, (winW - 24) / 2.15);

  if (bare) {
    return (
      <View style={styles.bareOuter} accessibilityLabel={title}>
        <Text style={styles.bareTitle}>{title}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.scrollerContent, { paddingLeft: 0, paddingRight: 8 }]}
          keyboardShouldPersistTaps="handled"
        >
          {sponsors.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[
                styles.scrollChip,
                styles.bareScrollChip,
                { width: itemW, height: ROW_H, borderRadius: logoRadius },
              ]}
              onPress={() => onSponsorPress(s)}
              activeOpacity={s.website_url ? 0.75 : 1}
              disabled={!s.website_url}
              accessibilityLabel={s.company_name}
            >
              {s.logo_url?.trim() ? (
                <SponsorMark uri={s.logo_url.trim()} style={[styles.scrollImage, { borderRadius: logoRadius }]} />
              ) : (
                <Text style={styles.fallback} numberOfLines={2}>
                  {s.company_name}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.wrap} accessibilityLabel={title}>
      <View style={styles.stripBand}>
        <Text style={styles.stripTitle}>{title}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.scrollerContent, { paddingLeft: 0, paddingRight: 8 }]}
          keyboardShouldPersistTaps="handled"
        >
          {sponsors.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.scrollChip, { width: itemW, height: ROW_H }]}
              onPress={() => onSponsorPress(s)}
              activeOpacity={s.website_url ? 0.75 : 1}
              disabled={!s.website_url}
              accessibilityLabel={s.company_name}
            >
              {s.logo_url?.trim() ? (
                <SponsorMark uri={s.logo_url.trim()} style={styles.scrollImage} />
              ) : (
                <Text style={styles.fallback} numberOfLines={2}>
                  {s.company_name}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    width: '100%',
    marginBottom: 4,
  },
  /** No band / border — sits in screen content padding (Info). */
  bareOuter: {
    alignSelf: 'stretch',
    width: '100%',
    marginBottom: 4,
  },
  bareTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  bareLogoClip: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  bareStackedList: {
    width: '100%',
    paddingBottom: 2,
  },
  bareFallbackBox: {
    minHeight: 44,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bareScrollChip: {
    borderWidth: 0,
    backgroundColor: colors.background,
  },
  /** Full-width band: matches Feed reference (white strip on surface / flat on white Info). */
  stripBand: {
    width: '100%',
    backgroundColor: colors.background,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  stripTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  singleTouch: {
    alignSelf: 'stretch',
    width: '100%',
  },
  /** Edge-to-edge logo band (original strip used ~6px inset only). */
  singleLogoRow: {
    width: '100%',
    paddingHorizontal: 6,
  },
  singleLogoMax: {
    width: '100%',
    alignSelf: 'stretch',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  singleBannerImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.background,
  },
  stackedList: {
    width: '100%',
    paddingHorizontal: 6,
    paddingBottom: 2,
  },
  stackedRow: {
    width: '100%',
    alignItems: 'center',
  },
  stackedRowSpacing: {
    marginTop: 8,
  },
  stackedLogoWrap: {
    width: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  stackedLogoImg: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.background,
  },
  stackedFallback: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 8,
  },
  fallbackBox: {
    minHeight: 44,
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  scrollChip: {
    marginRight: GAP,
    backgroundColor: colors.background,
    padding: 2,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scrollImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.background,
  },
  fallback: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
