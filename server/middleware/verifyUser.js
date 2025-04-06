import {createClient} from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const verifyUser = async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if(!token)
        return res.status(401).json({ error: 'Missing token'});

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user)   
        return res.status(401).json({ error: 'Invalid token' });

    req.user = user;
    next();
};