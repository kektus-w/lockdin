import express from 'express';
import cors from 'cors';
import {verifyUser} from './middleware/verifyUser.js';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

dotenv.config();
//require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.post('/login', async(req, res) => {
    const {email, password} = req.body;
    console.log("Login request:", email);

    const {data: loginData,error: loginError} = await supabase.auth.signInWithPassword({
        email,
        password
    });

    //console.log("Auth finished");

    if(loginError || !loginData.session || !loginData.user){
        console.error("Login failed:", loginError);
        return res.status(401).json({error: loginError?.message || 'Login failed.'});
    }

    const userId = loginData.user.id;
    const accessToken = loginData.session.access_token;

    const{data:profile, error:profileError} = await supabase
    .from('profile')
    .select('username, session_hours')
    .eq('id', userId)
    .single();

    //console.log("Profile fetch finished");

    if(profileError){
        console.error("Failed to fetch", profileError);
        return res.status(500).json({error: profileError.message});
    }

    res.status(200).json({
        access_token: accessToken,
        user: loginData.user,
        profile
    });
});

app.post('/signup', async (req, res) => {
    const { email, password, username } = req.body;

    console.log("Incoming signup: ", email, username);
    
    const { data: signupData, error: signupError } = await supabase.auth.signUp({
        email, 
        password
    });

    if(signupError || !signupData.user){
        return res.status(400).json({error: signupError?.message || 'Signup failed.'});
    }

    console.log("Signup successful. User ID: ", signupData.user.id);

    const userId = signupData.user.id;

    const {data: profile, error: profileError} = await supabase
    .from('profile')
    .insert({
        id: userId, 
        username: username || email.split('@')[0],
        session_hours: 0
    })
    .select();

    if (profileError){
        console.error("Profile insert failed:", profileError);
        return res.status(500).json({error: "Insert failed", rawError: profileError});
    }

    console.log("Profile created: ", profile);

    res.status(200).json({
        message: 'User signed up and profile created!',
        user: signupData.user,
        profile: profile[0]
    });
});

app.post('/friends/request', verifyUser, async(req, res) => {
    const {username} = req.body;
    const senderId = req.user.id;

    console.log("Friend request to:", username);

    const{ data:receiveProfile, error:findError} = await supabase
    .from('profile')
    .select('id')
    .eq('username', username)
    .single();

    if(findError || !receiveProfile){
        return res.status(404).json({error: 'User not found.'});
    }

    const receiverId = receiveProfile.id;

    if(receiverId == senderId){
        return res.status(400).json({error: "The ID is yourself!"});
    }

    const{data: existing, error: checkError} = await supabase
    .from('friends')
    .select('*')
    .or(`and(requester_id.eq.${senderId}, receiver_id.eq.${receiverId}), and(requester_id.eq.${receiverId}, receiver_id.eq.${senderId})`)
    .maybeSingle();

    if(existing){
        return res.status(409).json({error: 'Already Friends'});
    }

    const{data: request, error: insertError} = await supabase.from('friends')
    .insert({
        requester_id: senderId,
        receiver_id: receiverId,
        status: 'pending'
    })
    .select();

    if(insertError){
        console.error("Insert error:", insertError);
        return res.status(500).json({error: insertError.message});
    }

    res.status(200).json({
        message: `Friend request sent to ${username}`,
        friends: request[0]
    });
});

app.post('/friends/respond', verifyUser, async (req, res) => {
    const receiverId = req.user.id;
    const { requester_id, action } = req.body;
  
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }
  
    // Find the friendship request
    const { data: request, error: findError } = await supabase
      .from('friends')
      .select('*')
      .match({
        requester_id: requester_id,
        receiver_id: receiverId,
        status: 'pending'
      })
      .maybeSingle();
  
    if (findError || !request) {
      return res.status(404).json({ error: "Friend request not found" });
    }
  
    // Update the status
    const { data: updated, error: updateError } = await supabase
      .from('friends')
      .update({ status: action })
      .match({ id: request.id })
      .select();
  
    if (updateError) {
      console.error("Update error:", updateError);
      return res.status(500).json({ error: updateError.message });
    }
  
    res.status(200).json({
      message: `Friend request ${action}ed.`,
      friendship: updated[0]
    });
});

app.get('/friends/list', verifyUser, async (req, res) => {
    const userId = req.user.id;
  
    // Get all accepted friendships where the user is involved
    const { data, error } = await supabase
      .from('friends')
      .select(`
        id,
        requester_id,
        receiver_id,
        status,
        requester:profile!friends_request_id_fkey(username, session_hours),
        receiver:profile!friends_receive_id_fkey(username, session_hours)
      `)
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq('status', 'accept'); 
  
    if (error) {
      console.error("Error fetching friends:", error);
      return res.status(500).json({ error: error.message });
    }
  
    // Extract only the friend 
    const friends = data.map(f => {
      if (f.requester_id === userId) {
        return f.receiver;
      } else {
        return f.requester;
      }
    });
  
    res.status(200).json({ friends });
});

app.post('/groups/create', verifyUser, async (req, res) => {
    const { name } = req.body;
    const creatorId = req.user.id;
  
    if (!name) {
      return res.status(400).json({ error: "Group name is required" });
    }
  
    // Create the group
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .insert({
        name,
        creator_id: creatorId
      })
      .select()
      .single();
  
    if (groupError) {
      console.error("Group creation error:", groupError);
      return res.status(500).json({ error: groupError.message });
    }
  
    // Add the creator as a member of the group
    const { error: memberError } = await supabase
      .from('group_members')
      .insert({
        group_id: group.id,
        user_id: creatorId
      });
  
    if (memberError) {
      console.error("Failed to add creator as member:", memberError);
      return res.status(500).json({ error: "Group created, but failed to add creator as member." });
    }
  
    res.status(201).json({
      message: "Group created successfully",
      group
    });
});

app.post('/groups/join', verifyUser, async (req, res) => {
    const userId = req.user.id;
    const { group_id } = req.body;
  
    if (!group_id) {
      return res.status(400).json({ error: "Missing group ID" });
    }
  
    // Check if the group exists
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('id')
      .eq('id', group_id)
      .single();
  
    if (groupError || !group) {
      return res.status(404).json({ error: "Group not found" });
    }
  
    // Try to insert the user into group_members
    const { error: insertError } = await supabase
      .from('group_members')
      .insert({
        group_id,
        user_id: userId
    });
  
    if (insertError) {
      if (insertError.code === "23505") { // duplicate key
        return res.status(409).json({ error: "You are already a member of this group" });
      }
  
      console.error("Join error:", insertError);
      return res.status(500).json({ error: insertError.message });
    }
  
    res.status(200).json({ message: "Successfully joined the group" });
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);


//bugged
app.post('/groups/:groupId/deposit', verifyUser, async (req, res) => {
  const { groupId } = req.params;
  const { amount } = req.body; // amount in dollars
  const userId = req.user.id;

  //console.log("Reached /groups/:groupId/deposit");

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Group Contribution'
          },
          unit_amount: Math.round(amount * 100) // in cents
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:3000/cancel`,
      metadata: {
        user_id: userId,
        group_id: groupId
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
  
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
  
      const groupId = session.metadata.group_id;
      const userId = session.metadata.user_id;
      const amount = session.amount_total / 100;
  
      // Insert into a `group_payments` table 
      const { error } = await supabase
        .from('group_payments')
        .insert({ group_id: groupId, user_id: userId, amount });
  
      if (error) {
        console.error("Failed to log payment:", error);
      }
    }
  
    res.status(200).json({ received: true });
});

app.get('/groups/:groupId/total', verifyUser, async (req, res) => {
    const { groupId } = req.params;
  
    const { data, error } = await supabase
      .from('group_payments')
      .select('amount')
      .eq('group_id', groupId);
  
    if (error) {
      return res.status(500).json({ error: error.message });
    }
  
    const total = data.reduce((sum, payment) => sum + payment.amount, 0);
  
    res.status(200).json({
      group_id: groupId,
      total_deposited: total
    });
});

app.get('/groups/:groupId/contributions', verifyUser, async (req, res) => {
    const { groupId } = req.params;
  
    const { data, error } = await supabase
      .from('group_payments')
      .select(`
        user_id,
        amount,
        profile:user_id(username)
      `)
      .eq('group_id', groupId);
  
    if (error) {
      return res.status(500).json({ error: error.message });
    }
  
    // Aggregate total amount per user
    const contributions = {};
  
    data.forEach(entry => {
      const uid = entry.user_id;
      const username = entry.profile.username;
  
      if (!contributions[uid]) {
        contributions[uid] = { username, total: 0 };
      }
  
      contributions[uid].total += entry.amount;
    });
  
    res.status(200).json({ contributions });
});

app.get('/protected', verifyUser, (req, res) => {   // path, function, (request, response)
    res.json({message: `Hello ${req.user.email}`});
});

app.listen(3001, () => {
    console.log('Server is running on http://localhost:3001');
})