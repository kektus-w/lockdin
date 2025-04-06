import express from 'express';
import cors from 'cors';
import {verifyUser} from './middleware/verifyUser.js';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

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

app.get('/protected', verifyUser, (req, res) => {   // path, function, (request, response)
    res.json({message: `Hello ${req.user.email}`});
});

app.listen(3001, () => {
    console.log('Server is running on http://localhost:3001');
})