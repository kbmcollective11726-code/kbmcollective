import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      const err = this.state.error;
      const stack = err.stack ?? '';
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.message}>{err.message}</Text>
            {stack ? (
              <Text style={styles.stack} selectable>
                {stack}
              </Text>
            ) : null}
          </ScrollView>
          <TouchableOpacity style={styles.button} onPress={this.reset} activeOpacity={0.8}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#f8fafc',
    marginBottom: 12,
  },
  scroll: {
    maxHeight: 200,
    width: '100%',
    marginBottom: 16,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 8,
  },
  stack: {
    fontSize: 11,
    color: '#64748b',
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#2563eb',
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
