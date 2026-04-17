import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const CRYPTOMUS_API_KEY = process.env.CRYPTOMUS_API_KEY || '';

interface WebhookPayload {
  type: string;
  uuid: string;
  order_id: string;
  amount: string;
  payment_amount: string;
  payment_amount_usd: string;
  merchant_amount: string;
  commission: string;
  is_final: boolean;
  status: string;
  from: string;
  wallet_address_uuid: string;
  network: string;
  currency: string;
  payer_currency: string;
  additional_data: string;
  txid: string;
  sign: string;
}

function verifySign(payload: WebhookPayload): boolean {
  const { sign, ...data } = payload;
  const jsonData = JSON.stringify(data);
  const base64Data = Buffer.from(jsonData).toString('base64');
  const expectedSign = crypto
    .createHash('md5')
    .update(base64Data + CRYPTOMUS_API_KEY)
    .digest('hex');
  return sign === expectedSign;
}

export async function POST(request: NextRequest) {
  try {
    const payload: WebhookPayload = await request.json();

    // Verify webhook signature (skip in demo mode)
    if (CRYPTOMUS_API_KEY && !verifySign(payload)) {
      console.error('Invalid webhook signature');
      return NextResponse.json(
        { success: false, error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const { status, order_id, additional_data, is_final } = payload;

    console.log('Payment webhook received:', {
      orderId: order_id,
      status,
      isFinal: is_final,
    });

    // Parse additional data
    let orderData;
    try {
      orderData = JSON.parse(additional_data);
    } catch {
      orderData = {};
    }

    // Handle payment status
    if (status === 'paid' || status === 'paid_over') {
      // Payment successful
      // In a real implementation, this would:
      // 1. Update the order status in the database
      // 2. Create the WireGuard peer
      // 3. Generate the configuration
      // 4. Send email to user with config
      // 5. Enable auto-disable scheduler

      console.log('Payment successful for order:', order_id);
      console.log('Order data:', orderData);

      // TODO: Implement actual peer creation and subscription activation
      // This would connect to your WireGuard server and create the peer
    } else if (status === 'cancel' || status === 'fail') {
      // Payment failed or cancelled
      console.log('Payment failed/cancelled for order:', order_id);

      // TODO: Update order status and notify user
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
