const express = require('express');
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import cors from 'cors';

const admin = require('firebase-admin');
const Stripe = require('stripe');
import bodyParser from 'body-parser';

const dotenv = require('dotenv');
dotenv.config();


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));



admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


const app = express();
const port = 3000;
app.use(
  '/webhook',
  bodyParser.raw({ type: 'application/json' })
);

app.use(express.json());
app.use(cors({
  origin: 'https://animefactory.art', // replace with your real domain
}));

app.use(express.static('public'));

app.get('/membership', (req, res) => {
  res.sendFile(process.cwd() + '/public/membership.html');
});


const privateKey = fs.readFileSync('private_key.pem', 'utf8');
const appId = 'rt5k-rdeV'; // replace with your real app ID

import { getAuth } from 'firebase-admin/auth';

async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    req.user = decodedToken; // Optional: access uid/email later
    next(); // Go to the route
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
app.post('/api/create-checkout-session', verifyFirebaseToken, async (req, res) => {
  const { priceId } = req.body;
  const firebaseUid = req.user.uid;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://animefactory.art/success',
      cancel_url: 'https://animefactory.art/cancel',
      metadata: {
        firebaseUid,
        priceId,
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('❌ Stripe checkout session error:', err.message);
    res.status(500).json({ error: 'Stripe checkout failed' });
  }
});

// Submit generation job
app.post('/api/generate', verifyFirebaseToken, async (req, res) => {
  console.log(`Generating for UID: ${req.user.uid}`);

  const prompt = req.body.prompt + ", ,score_9,score_8, ,vivid colours, polished art, , source_anime, anime style, , official art,, best quality, masterpiece, , hi res, best_quality, very aesthetic, absurdres, 8k,";

  const requestBody = {
  request_id: Date.now().toString(),
  stages: [
    {
      type: 'INPUT_INITIALIZE',
      inputInitialize: {
        seed: -1,
        count: 1,
      },
    },
    {
      type: 'DIFFUSION',
      diffusion: {
        width: 1024,
        height: 1360,
        prompts: [{ text: prompt }],
        negativePrompts: [
          {
            text: "monochrome, greyscale, large_areolas, big_areolae, (deformed, distorted, disfigured:1.4), (mutated hands and fingers:1.4), score_5, score_4, text, censored, deformed, bad hand, blurry, (watermark), extra hands, kid, earrings, chin sweat, bod, fat bbw, curvy, 3d, flowers in hair, real life, realistic, 4K, 8k, high_resolution, shading, professional lighting, volumetric lighting, detailed"
          },
        ],
        steps: 20,
        sd_model: '840915259221871955',
        clip_skip: 2,
        cfg_scale: 6,
        sampler: 'Euler a',
        embedding: {},
        lora: {
          items: [
            { loraModel: "746566089133031686", weight: 0.8 },
            { loraModel: "801237307664398868", weight: 0.5 },
            { loraModel: "766132482665064102", weight: 0.2 },
            { loraModel: "710266515901029566", weight: -1 }
          ]
        }
      }
    },
    {
      type: 'IMAGE_TO_ADETAILER',
      imageToAdetailer: {
        args: [
          {
            adModel: "face_yolov8s.pt",
            adPrompt: [{ text: "" }],
            adNegativePrompt: [{ text: "" }],
            adConfidence: 0.7,
            adDilateErode: 2,
            adMaskMergeInvert: "None",
            adDenoisingStrength: 0.27,
            adInpaintOnlyMasked: true,
            adInpaintOnlyMaskedPadding: 32,
            adUseInpaintWidthHeight: false,
            adInpaintWidth: 1024,
            adInpaintHeight: 1360,
            adUseSteps: false,
            adSteps: 10,
            adUseCfgScale: false,
            adCfgScale: 4,
          }
        ]
      }
    }
  ]
};


  const method = 'POST';
  const urlPath = '/v1/jobs';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyString = JSON.stringify(requestBody);

  const stringToSign = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${bodyString}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(stringToSign);
  signer.end();
  const signature = signer.sign(privateKey, 'base64');

  const authHeader = `TAMS-SHA256-RSA app_id=${appId},nonce_str=${nonce},timestamp=${timestamp},signature=${signature}`;

  try {
    const response = await axios.post(
      'https://ap-east-1.tensorart.cloud/v1/jobs',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
      }
    );
    console.log('Job submission response:', response.data); // ✅ NOW it's valid
    res.json({ jobId: response.data.job.id });
  } catch (err) {
    console.error('Job submit error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Job submission failed',
      details: err.response?.data || err.message
    });
  }
});


// Check job status
app.get('/api/job/:jobId', async (req, res) => {
  const { jobId } = req.params;

  const method = 'GET';
  const urlPath = `/v1/jobs/${jobId}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyString = '';

  const stringToSign = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${bodyString}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(stringToSign);
  signer.end();
  const signature = signer.sign(privateKey, 'base64');

  const authHeader = `TAMS-SHA256-RSA app_id=${appId},nonce_str=${nonce},timestamp=${timestamp},signature=${signature}`;

  try {
    const response = await axios.get(
      `https://ap-east-1.tensorart.cloud/v1/jobs/${jobId}`,
      {
        headers: {
          Authorization: authHeader,
        },
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error('Job fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Job status check failed' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = 'whsec_WTrCJULOtJRs6lx65RzWFjf6N9flZNmp'; // Your Stripe webhook secret

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

 if (event.type === 'checkout.session.completed') {
  const session = event.data.object;

  const firebaseUid = session.metadata.firebaseUid;
  const priceId = session.metadata.priceId;

  // 🔁 Map Stripe Price IDs to credit amounts and plan names
  const priceMap = {
    'price_1RZGxARrjDStXR6K6i5k60QI': { credits: 600, plan: 'pro' },
    'price_1ObKABC123xyzEXAMPLE1': { credits: 300, plan: 'basic' },
    'price_1ObKXYZ789defEXAMPLE2': { credits: 1000, plan: 'premium' },
  };

  const mapping = priceMap[priceId];

  if (!mapping) {
    console.warn('⚠️ Unknown price ID in webhook:', priceId);
    return res.status(200).end(); // Don't fail webhook but skip update
  }

  const { credits, plan } = mapping;

  try {
    const userRef = admin.firestore().collection('users').doc(firebaseUid);
    await userRef.set({
      credits,
      plan,
      lastRenewed: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`✅ Assigned ${credits} credits to ${firebaseUid} for ${plan} plan`);
  } catch (err) {
    console.error('❌ Firestore update error in webhook:', err.message);
  }

  return res.status(200).end();
}

});
