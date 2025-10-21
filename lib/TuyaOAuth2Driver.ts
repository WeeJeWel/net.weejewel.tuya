import { OAuth2DeviceResult, OAuth2Driver, OAuth2Util, fetch } from 'homey-oauth2app';
import {
  type TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../types/TuyaApiTypes';
import type { StandardFlowArgs, Translation } from '../types/TuyaTypes';
import TuyaOAuth2Client from './TuyaOAuth2Client';
import { sendSetting } from './TuyaOAuth2Util';

import * as TuyaOAuth2Util from './TuyaOAuth2Util';
import { PairSession } from 'homey/lib/Driver';
import TuyaOAuth2Token from './TuyaOAuth2Token';

export type ListDeviceProperties = {
  store: {
    [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  settings: {
    [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  capabilities: string[];
  capabilitiesOptions: {
    [key: string]: {
      [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  };
};

export default class TuyaOAuth2Driver extends OAuth2Driver<TuyaOAuth2Client> {
  TUYA_DEVICE_CATEGORIES: ReadonlyArray<string> = [];

  async onPair(session: PairSession): Promise<void> {
    const client_id = 'HA_3y9q4ak7g4ephrvke';
    const schema = 'haauthorize';

    let usercode: string;
    let qrcode: string;
    let fetchTokenInterval: NodeJS.Timeout;

    let oAuth2Client: TuyaOAuth2Client;
    let oAuth2Token: TuyaOAuth2Token;

    session.setHandler('getLinked', async () => {
      try {
        oAuth2Client = this.homey.app.getFirstSavedOAuth2Client();
        return true;
      } catch (err) {
        return false;
      }
    });

    session.setHandler('usercode', async data => {
      usercode = data.usercode;

      const url = new URL('https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens');
      url.searchParams.append('clientid', client_id);
      url.searchParams.append('schema', schema);
      url.searchParams.append('usercode', usercode);

      qrcode = await fetch(url.toString(), {
        method: 'POST',
      })
        .then((res: any) => {
          if (!res.ok) {
            throw new Error(res.statusText);
          }
          return res.json();
        })
        .then((res: any) => {
          if (res.success === false) {
            throw new Error(res.msg ?? res.code);
          }
          if (res.success === true) {
            return res.result.qrcode;
          }
          throw new Error('Unknown Response Format');
        });

      fetchTokenInterval = setInterval(() => {
        Promise.resolve().then(async () => {
          const url = new URL(`https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens/${qrcode}`);
          url.searchParams.append('clientid', client_id);
          url.searchParams.append('usercode', usercode);

          const token = await fetch(url.toString())
            .then((res: any) => {
              if (!res.ok) {
                throw new Error(res.statusText);
              }
              return res.json();
            })
            .then((res: any) => {
              if (res.success === false) {
                throw new Error(res.msg ?? res.code);
              }
              if (res.success === true) {
                return res.result;
              }
              throw new Error('Unknown Response Format');
            });

          oAuth2Client = this.homey.app.createOAuth2Client({
            sessionId: OAuth2Util.getRandomId(),
            configId: this.getOAuth2ConfigId(),
          });

          oAuth2Token = new TuyaOAuth2Token(token);
          oAuth2Client.setToken({
            token: oAuth2Token,
          });
          oAuth2Client.save();

          clearInterval(fetchTokenInterval);
          await session.showView('list_devices');
        }).catch(err => this.error(`Token fetch error: ${err.message}`));
      }, 1000);

      return qrcode;
    });

    session.setHandler('list_devices', async () => {
      return this.onPairListDevices({
        oAuth2Client,
      });
    });

    session.setHandler('disconnect', async (): Promise<void> => {
      clearInterval(fetchTokenInterval);
    });
  }

  async onPairListDevices({ oAuth2Client }: { oAuth2Client: TuyaOAuth2Client }): Promise<OAuth2DeviceResult[]> {
    const listDevices: OAuth2DeviceResult[] = [];

    const homes = await oAuth2Client.getHomesHA();
    for (const home of Object.values(homes)) {
      const devices = await oAuth2Client.getDevicesHA({
        homeId: home.ownerId,
      });
      console.log('devices', devices);
      const filteredDevices = devices.filter(device => {
        return !oAuth2Client.isRegistered(device.product_id, device.id) && this.onTuyaPairListDeviceFilter(device);
      });

      this.log('Listing devices to pair:');

      for (const device of filteredDevices) {
        this.log('Device:', JSON.stringify(TuyaOAuth2Util.redactFields(device)));
        const deviceSpecs =
          (await oAuth2Client
            .getSpecification(device.id)
            .catch(e => this.log('Device specification retrieval failed', e))) ?? undefined;
        const dataPoints =
          (await oAuth2Client.queryDataPoints(device.id).catch(e => this.log('Device properties retrieval failed', e))) ??
          undefined;

        // GitHub #178: Some device do not have the status property at all.
        // Make sure to populate it with an empty array instead.
        if (!Array.isArray(device.status)) {
          device.status = [];
        }

        const deviceProperties = this.onTuyaPairListDeviceProperties({ ...device }, deviceSpecs, dataPoints);

        listDevices.push({
          ...deviceProperties,
          name: device.name,
          data: {
            deviceId: device.id,
            productId: device.product_id,
          },
        });
      }
    }

    return listDevices;
  }

  onTuyaPairListDeviceFilter(device: TuyaDeviceResponse): boolean {
    return this.TUYA_DEVICE_CATEGORIES.includes(device.category);
  }

  onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse, // eslint-disable-line @typescript-eslint/no-unused-vars
    specifications?: TuyaDeviceSpecificationResponse, // eslint-disable-line @typescript-eslint/no-unused-vars
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const combinedSpecification = {
      device: TuyaOAuth2Util.redactFields(device),
      specifications: specifications ?? '<not available>',
      data_points: dataPoints?.properties ?? '<not available>',
    };

    return {
      capabilities: [],
      store: {
        tuya_capabilities: [],
        tuya_category: device.category,
      },
      capabilitiesOptions: {},
      settings: {
        deviceSpecification: JSON.stringify(combinedSpecification, undefined, 2),
      },
    };
  }

  protected addSettingFlowHandler<K extends string, L extends Record<K, Translation>>(setting: K, labels: L): void {
    this.homey.flow
      .getActionCard(`${this.id}_${setting}`)
      .registerRunListener(
        async (args: StandardFlowArgs) => await sendSetting(args.device, setting, args.value, labels),
      );
  }
}

module.exports = TuyaOAuth2Driver;
