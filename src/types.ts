/**
 * Represents the status of an OS service.
 */
export interface ServiceStatus {
  /** The service name as provided. */
  name: string;
  /** Always `true` (throws if the service is missing). */
  exists: boolean;
  /**
   * One of: RUNNING | STOPPED | START_PENDING |
   * STOP_PENDING | CONTINUE_PENDING | PAUSE_PENDING |
   * PAUSED | UNKNOWN(<raw>).
   */
  state: string;
  /** Main process ID (0 when the service is stopped). */
  pid: number;
  /** The raw state value from the OS. */
  rawCode: string | number;
}

/**
 * The platform-specific module contract.
 */
export interface ServiceModule {
  serviceExists(serviceName: string): Promise<boolean>;
  getServiceStatus(serviceName: string): Promise<ServiceStatus>;
}
