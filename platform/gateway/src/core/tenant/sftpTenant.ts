import type { SftpProvisioningDetails } from "../azure/storageSftp";

export type SftpSuccessUpdate = {
  sftp_username: string;
  sftp_home_uri: string;
  sftp_enabled: boolean;
  sftp_provisioned_at: Date;
  sftp_last_error_code: null;
  sftp_last_error_at: null;
};

export type SftpFailureUpdate = {
  sftp_enabled: boolean;
  sftp_last_error_code: string;
  sftp_last_error_at: Date;
};

export const buildSftpSuccessUpdate = (
  details: SftpProvisioningDetails,
  now: Date = new Date()
): SftpSuccessUpdate => ({
  sftp_username: details.username,
  sftp_home_uri: details.homeUri,
  sftp_enabled: true,
  sftp_provisioned_at: now,
  sftp_last_error_code: null,
  sftp_last_error_at: null
});

export const buildSftpFailureUpdate = (errorCode: string, now: Date = new Date()): SftpFailureUpdate => ({
  sftp_enabled: false,
  sftp_last_error_code: errorCode,
  sftp_last_error_at: now
});
