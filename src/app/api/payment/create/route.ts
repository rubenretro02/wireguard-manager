import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Cryptomus API configuration
const CRYPTOMUS_API_URL = 'https://api.cryptomus.com/v1';
const CRYPTOMUS_MERCHANT_ID = process.env.CRYPTOMUS_MERCHANT_ID || '';
const CRYPTOMUS_API_KEY = process.env.CRYPTOMUS_API_KEY || '';

interface PaymentRequest {
  amount: number;
  orderId: string;
  duration: string;
  userId: string;
  ipId: string;
  location: {
    country: string;
    state: string;
    city: string;
  };
}

function generateSign(data: Record<string, unknown>): string {
  const jsonData = JSON.stringify(data);
  const base64Data = Buffer.from(jsonData).toString('base64');
  return crypto
    .createHash('md5')
    .update(base64Data + CRYPTOMUS_API_KEY)
    .digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const body: PaymentRequest = await request.json();
    const { amount, orderId, duration, userId, ipId, location } = body;

    if (!amount || !orderId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create payment request for Cryptomus
    const paymentData = {
      amount: amount.toString(),
      currency: 'USD',
      order_id: orderId,
      url_return: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://vpn.blackgott.com'}/dashboard`,
      url_success: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://vpn.blackgott.com'}/dashboard?payment=success`,
      url_callback: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://vpn.blackgott.com'}/api/payment/webhook`,
      is_payment_multiple: false,
      lifetime: 3600, // 1 hour
      additional_data: JSON.stringify({
        userId,
        ipId,
        duration,
        location,
      }),
    };

    // For demo purposes, return a mock payment URL
    // In production, this would call the actual Cryptomus API
    if (!CRYPTOMUS_MERCHANT_ID || !CRYPTOMUS_API_KEY) {
      // Demo mode - simulate payment success
      return NextResponse.json({
        success: true,
        data: {
          uuid: `demo-${Date.now()}`,
          order_id: orderId,
          amount: amount.toString(),
          url: `${process.env.NEXT_PUBLIC_BASE_URL || ''}/dashboard?payment=demo&orderId=${orderId}`,
          status: 'pending',
        },
        message: 'Demo mode - Cryptomus credentials not configured',
      });
    }

    const sign = generateSign(paymentData);

    const response = await fetch(`${CRYPTOMUS_API_URL}/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        merchant: CRYPTOMUS_MERCHANT_ID,
        sign: sign,
      },
      body: JSON.stringify(paymentData),
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: result.message || 'Payment creation failed' },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.result,
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
