import { describe, it, expect } from 'vitest';
import { BufferJSON } from '@whiskeysockets/baileys';

describe('Baileys BufferJSON Serialization', () => {
  it('deve serializar e deserializar Buffers e chaves criptográficas perfeitamente', () => {
    const testKey = {
      type: 'Buffer',
      data: Buffer.from('whatsapp-secret-session-key-12345'),
    };

    const originalObject = {
      registrationId: 1234,
      signedPreKey: {
        keyPair: {
          public: Buffer.from([1, 2, 3, 4, 5]),
          private: Buffer.from([6, 7, 8, 9, 10]),
        },
        signature: Buffer.from('signature-bytes'),
        keyId: 1,
      },
    };

    const serialized = JSON.parse(JSON.stringify(originalObject, BufferJSON.replacer));
    const deserialized = JSON.parse(JSON.stringify(serialized), BufferJSON.reviver);

    expect(Buffer.isBuffer(deserialized.signedPreKey.keyPair.public)).toBe(true);
    expect(Buffer.isBuffer(deserialized.signedPreKey.keyPair.private)).toBe(true);
    expect(Buffer.isBuffer(deserialized.signedPreKey.signature)).toBe(true);
    expect(deserialized.signedPreKey.keyId).toBe(1);
    expect(deserialized.signedPreKey.signature.toString()).toBe('signature-bytes');
  });
});
